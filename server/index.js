import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import OpenAI from 'openai';
import { createServer } from 'http';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Create HTTP server
const server = createServer(app);

// Middleware
app.use(
  cors({
    origin: ['http://localhost:3000', 'https://flex.twilio.com'],
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Twilio configuration
const { TWILIO_FLEX_PHONE_NUMBER, SERVER_URL } = process.env;

// Store active call mappings (in production, use a database)
const activeCalls = new Map(); // calls in Voice channel in Flex, keyed by CallSid
const activeConversations = new Map(); // Conversation Orchestrator conversations, keyed by conversationId

// Store live conversation data (transcript + CINTEL results)
// Key: sessionId or callSid
const liveConversationData = new Map();
const tempConversationData = new Map(); // Temporary storage for conversations without callSid mapping

// Map conversationId (from CINTEL v3) to callSid
const conversationIdToCallSid = new Map();

// Store SSE clients for streaming updates
const sseClients = new Map();

// Store participants by conversationId
// Key: conversationId, Value: Map of participantId -> { id, name, type, channel }
const conversationParticipants = new Map();

/**
 * POST /webhook/status
 * Webhook for call status updates
 */
app.post('/webhook/status', (req, res) => {
  const { CallSid, CallStatus, From, To, ConversationStatus } = req.body;

  console.log(`Call status update: ${CallSid} - ${CallStatus}`);
  console.log(`From: ${From}, To: ${To}`);

  // Update call status in memory
  if (activeCalls.has(CallSid)) {
    const callData = activeCalls.get(CallSid);
    callData.status = CallStatus;
    callData.updatedAt = new Date();

    // Clean up completed calls after 5 minutes
    if (
      CallStatus === 'completed' ||
      CallStatus === 'failed' ||
      CallStatus === 'canceled'
    ) {
      setTimeout(
        () => {
          activeCalls.delete(CallSid);
          console.log(`Cleaned up call ${CallSid}`);
        },
        5 * 60 * 1000,
      );
    }
  }

  res.sendStatus(200);
});

/**
 * GET /api/call/:callSid
 * Get status of a specific call
 */
app.get('/api/call/:callSid', (req, res) => {
  const { callSid } = req.params;

  if (activeCalls.has(callSid)) {
    res.json(activeCalls.get(callSid));
  } else {
    res.status(404).json({ error: 'Call not found' });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeCalls: activeCalls.size,
    activeConversations: activeConversations.size,
  });
});

/**
 * GET /api/stream/:sessionId
 * Unified Server-Sent Events endpoint for real-time conversation updates
 * Handles both Call SIDs (voice) and Conversation SIDs (digital channels)
 */
app.get('/api/stream/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  console.log(`SSE client connected for session ${sessionId}`);

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // CORS handling for Flex agent desktop
  const allowedOrigins = ['http://localhost:3000', 'https://flex.twilio.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`);

  // Store client for this session
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, []);
  }
  sseClients.get(sessionId).push(res);

  console.log(
    `SSE client registered. Total clients for ${sessionId}: ${sseClients.get(sessionId).length}`,
  );

  // Send existing data if any
  if (liveConversationData.has(sessionId)) {
    const data = liveConversationData.get(sessionId);
    console.log(
      `Sending initial data - ${data.transcript.length} transcript entries, ${data.operatorResults.length} operator results`,
    );
    res.write(
      `data: ${JSON.stringify({
        type: 'initial',
        transcript: data.transcript,
        operatorResults: data.operatorResults,
      })}\n\n`,
    );
  } else {
    console.log(`No existing conversation data for ${sessionId}`);
  }

  // Handle client disconnect
  req.on('close', () => {
    console.log(`SSE client disconnected for session ${sessionId}`);
    const clients = sseClients.get(sessionId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index > -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        sseClients.delete(sessionId);
      }
    }
  });
});

app.post('/webhook/cor-event', (req, res) => {
  // Handle Conversation Orchestrator event webhook

  // console.log(
  //   'Conversation Orchestrator event webhook received:',
  //   JSON.stringify(req.body, null, 2),
  // );

  const event = req.body;

  if (event) {
    const { conversationId, id, name, type, addresses } = event.data;
    // Handle PARTICIPANT_ADDED event
    if (event.eventType === 'PARTICIPANT_ADDED') {
      // Handle Conversation Orchestrator event webhook
      console.log(
        'Conversation Orchestrator PARTICIPANT_ADDED event webhook received:',
        JSON.stringify(req.body, null, 2),
      );

      // Extract channel from addresses array (first address)
      const channel = addresses && addresses[0] ? addresses[0].channel : null;

      // Create participant object
      const participant = {
        id,
        name,
        type,
        channel,
      };

      // check if name (phone number) matches the Flex phone number
      // if so, this is the agent

      if (name === TWILIO_FLEX_PHONE_NUMBER) {
        console.log(
          `👤 Participant ${name} matches Flex phone number, identifying as agent`,
        );
        participant.type = 'AGENT';
      }

      // Initialize participants map for this conversation if needed
      if (!conversationParticipants.has(conversationId)) {
        conversationParticipants.set(conversationId, new Map());
        console.log(
          `👥 Created new participants map for conversation: ${conversationId}`,
        );
      }

      // Add participant to the map
      const participants = conversationParticipants.get(conversationId);
      participants.set(id, participant);

      console.log(
        `👤 Added participant to conversation ${conversationId}:`,
        participant,
      );
      console.log(
        `   Total participants in conversation: ${participants.size}`,
      );
    }

    // Handle COMMUNICATION_CREATED event
    if (event.eventType === 'COMMUNICATION_CREATED') {
      // Handle Conversation Orchestrator event webhook
      console.log(
        'Conversation Orchestrator COMMUNICATION_CREATED event webhook received:',
        JSON.stringify(req.body, null, 2),
      );
      const { conversationId, author, content, channelId } = event.data;
      let callSid = conversationIdToCallSid.get(conversationId);
      // get CallSID
      if (author?.channel === 'VOICE') {
        if (!callSid) {
          callSid = channelId; // In voice interactions, channelId is the callSid
          conversationIdToCallSid.set(conversationId, callSid);
          console.log(
            `🔗 Mapped conversationId ${conversationId} to callSid ${callSid} from COMMUNICATION_CREATED event`,
          );
        }
      }
      if (content && content.type === 'TRANSCRIPTION') {
        const speaker =
          author.address === TWILIO_FLEX_PHONE_NUMBER ? 'agent' : 'customer';
        const transcriptEntry = {
          timestamp: new Date().toISOString(),
          speaker: speaker,
          text: content.text || '',
        };

        if (!callSid) {
          console.warn(
            `No callSid mapping found for conversationId ${conversationId}, dropping transcript entry`,
          );
        } else {
          ensureConversationData(callSid);
          const conversationData = liveConversationData.get(callSid);
          conversationData.transcript.push(transcriptEntry);
          console.log(
            `Added ${speaker} transcript entry for call ${callSid}:`,
            transcriptEntry,
          );
          broadcastToClients(callSid, {
            type: 'transcript',
            data: transcriptEntry,
          });
        }
      }
    }
  }
  res.sendStatus(200);
});

/**
 * POST /webhook/cintel-action
 * Webhook for CINTEL v3 Rule Execution (Operator Results)
 */
app.post('/webhook/cintel-action', (req, res) => {
  try {
    const payload = req.body;
    console.log('\n========================================');
    console.log('🔔 CINTEL v3 Webhook received!');
    console.log('========================================');
    // console.log('📦 FULL WEBHOOK PAYLOAD FROM CINTEL (untransformed):');
    // console.log(JSON.stringify(payload, null, 2));

    // Parse CINTEL v3 payload structure
    const {
      accountId,
      conversationId,
      intelligenceConfiguration,
      operatorResults,
    } = payload;

    if (!conversationId) {
      console.warn('❌ No conversationId in CINTEL v3 webhook payload');
      return res.sendStatus(200);
    }

    console.log(`\n📊 Processing CINTEL webhook (envelope level):`);
    console.log(
      `   - Conversation ID: ${conversationId} (from webhook envelope)`,
    );
    console.log(`   - Account ID: ${accountId} (from webhook envelope)`);
    console.log(
      `   - Intelligence Config: ${intelligenceConfiguration?.displayName || intelligenceConfiguration?.friendlyName || 'Unknown'} (from webhook envelope)`,
    );
    console.log(
      `   - Number of operator results: ${operatorResults?.length || 0}`,
    );

    // Try to find the associated callSid
    let callSid = conversationIdToCallSid.get(conversationId);

    const haveFlexMapping = callSid;

    if (!haveFlexMapping) {
      console.warn(
        `⚠️  No Flex mapping found for conversationId: ${conversationId}`,
      );
      console.warn(
        `⚠️  Without mapping, operator results won't appear in the UI!`,
      );
    }

    // Use callSid if available, otherwise use conversationId as the key
    const dataKey = callSid || conversationId;
    console.log(`   - Using data key: ${dataKey}`);

    ensureConversationData(dataKey, {
      conversationId,
      accountId,
      intelligenceConfiguration,
    });

    const conversationData = liveConversationData.get(dataKey);

    // Update intelligence configuration metadata
    conversationData.conversationId = conversationId;
    conversationData.accountId = accountId;
    conversationData.intelligenceConfiguration = intelligenceConfiguration;

    // Process each operator result in the array
    if (operatorResults && Array.isArray(operatorResults)) {
      console.log(
        `\n📋 Processing ${operatorResults.length} individual operator result(s) from operatorResults[]:`,
      );

      operatorResults.forEach((opResult, index) => {
        console.log(
          `\n   ═══ Operator Result #${index + 1} (from operatorResults array) ═══`,
        );

        const {
          id,
          operator,
          outputFormat,
          result,
          dateCreated,
          referenceIds,
          executionDetails,
        } = opResult;

        // Format operator result for storage and display
        const operatorName =
          operator?.displayName || operator?.friendlyName || 'Unknown Operator';

        const formattedResult = {
          id,
          timestamp: dateCreated || new Date().toISOString(),
          conversationId: conversationId, // ADDED by server from webhook envelope (not in individual opResult)
          operator: {
            id: operator?.id,
            friendlyName: operatorName,
            version: operator?.version,
            parameters: operator?.parameters,
          },
          outputFormat,
          result,
          referenceIds,
          executionDetails: {
            trigger: executionDetails?.trigger,
            communications: executionDetails?.communications,
            channels: executionDetails?.channels,
            participants: executionDetails?.participants,
            context: executionDetails?.context,
          },
          rawPayload: opResult, // UNCHANGED - this is the raw operator result from CINTEL
        };

        conversationData.operatorResults.push(formattedResult);

        console.log(`      - Operator: ${operatorName}`);
        console.log(`      - Output Format: ${outputFormat}`);
        console.log(`      - Result:`, JSON.stringify(result, null, 2));
        console.log(
          `      - Raw Payload (untransformed from CINTEL):`,
          JSON.stringify(opResult, null, 2),
        );
        console.log(`      - Stored in conversation data for key: ${dataKey}`);
        console.log(
          `      - Total operator results now: ${conversationData.operatorResults.length}`,
        );

        // Broadcast to SSE clients if we have a callSid
        if (callSid) {
          broadcastToClients(callSid, {
            type: 'operator-result',
            data: formattedResult,
          });
        } else {
          console.log(`      - ⚠️  NOT broadcasting - no mapping available`);
        }
      });

      console.log(`\n✅ Finished processing all operator results`);
    } else {
      console.log(`⚠️  No operator results in payload or not an array`);
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing CINTEL v3 webhook:', error);
    res.sendStatus(500);
  }
});

/**
 * Initialize conversation data for a key if it doesn't already exist.
 * If it does exist, fills in any missing (null/undefined) fields from extras.
 */
function ensureConversationData(key, extras = {}) {
  if (!liveConversationData.has(key)) {
    liveConversationData.set(key, {
      transcript: [],
      operatorResults: [],
      startTime: new Date(),
      ...extras,
    });
    console.log(`📝 Created new conversation data for key: ${key}`);
  } else {
    const data = liveConversationData.get(key);
    for (const [field, value] of Object.entries(extras)) {
      if (data[field] == null && value != null) {
        data[field] = value;
      }
    }
    console.log(`📝 Found existing conversation data for key: ${key}`);
  }
}

/**
 * Helper function to broadcast updates to SSE clients
 */
function broadcastToClients(sessionId, message) {
  const clients = sseClients.get(sessionId);
  console.log(
    `Broadcasting to ${clients?.length || 0} clients for sessionId ${sessionId}:`,
    message.type,
  );
  if (clients && clients.length > 0) {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    clients.forEach((client) => {
      try {
        client.write(data);
        console.log(`Successfully broadcast ${message.type} to client`);
      } catch (error) {
        console.error('Error writing to SSE client:', error);
      }
    });
  } else {
    console.warn(`No SSE clients found for sessionId ${sessionId}`);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
  console.log(`Webhook URL: ${SERVER_URL}/webhook/incoming`);
  console.log(`Status webhook URL: ${SERVER_URL}/webhook/status`);

  // Validate required environment variables
  const requiredVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_API_KEY',
    'TWILIO_API_SECRET',
    'TWILIO_FLEX_PHONE_NUMBER',
    'SERVER_URL',
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.warn('⚠️  WARNING: Missing environment variables:');
    missingVars.forEach((varName) => console.warn(`   - ${varName}`));
    console.warn('Please configure these in your .env file');
  } else {
    console.log('✓ All required environment variables are set');
  }

  console.log('📊 Conversational Intelligence will analyze your conversations');
});
