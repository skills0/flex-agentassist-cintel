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
const {
  TWILIO_FLEX_PHONE_NUMBER,
  OPENAI_API_KEY,
  SERVER_URL,
  AI_CUSTOMER_PROMPT,
} = process.env;

// OpenAI configuration
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Store active call mappings (in production, use a database)
const activeCalls = new Map(); // calls in Voice channel in Flex, keyed by CallSid
const activeInteractions = new Map(); // interactions in Messaging channels in Flex, keyed by ConversationSid
const activeConversations = new Map(); // Conversation Orchestrator conversations, keyed by conversationId

// Store live conversation data (transcript + CINTEL results)
// Key: sessionId or callSid
const liveConversationData = new Map();

// Map conversationId (from CINTEL v3) to callSid
const conversationIdToCallSid = new Map();
const conversationIdToConversationSid = new Map(); // For non-voice channels

// Store SSE clients for streaming updates
const sseClients = new Map();

// Store participants by conversationId
// Key: conversationId, Value: Map of participantId -> { id, name, type, channel }
const conversationParticipants = new Map();

const conversationv1Messages = new Map(); // Key: conversationSid, Value: Map of a participant message -> { message, address, channel }

/**
 * Helper function to find and map a conversationId to a conversationSid
 * by matching author and message text in conversationv1Messages
 * @param {string} conversationId - The Conversation Orchestrator conversation ID
 * @param {object} author - Author object with address property
 * @param {string} messageText - The message text to match
 * @returns {string|null} - The conversationSid if found, null otherwise
 */
function findOrCreateConversationMapping(conversationId, author, messageText) {
  // Check if mapping already exists
  let existingConversationSid =
    conversationIdToConversationSid.get(conversationId);

  if (existingConversationSid) {
    return existingConversationSid;
  }

  // Search for matching author AND message text in conversationv1Messages
  for (const [conversationSid, messages] of conversationv1Messages) {
    if (messages.has(author.address)) {
      console.log(
        'Found matching author in conversationv1Messages:',
        author.address,
        conversationSid,
      );
      const storedMessage = messages.get(author.address);
      // Match both author AND message text
      if (storedMessage.message === messageText) {
        console.log(
          `✅ Found matching v1 message for author ${author.address} with matching text in conversation ${conversationSid}:`,
          storedMessage,
        );

        // Create mapping from conversationId to conversationSid
        conversationIdToConversationSid.set(conversationId, conversationSid);
        console.log(
          `✅ Auto-created mapping: ${conversationId} -> ${conversationSid}`,
        );
        return conversationSid;
      } else {
        console.log(
          `⚠️  Author ${author.address} found but message text doesn't match. Expected: "${messageText}", Got: "${storedMessage.message}"`,
        );
      }
    }
  }

  console.log(
    `⚠️  No matching v1 message found for author ${author.address} with text "${messageText}" in conversationId ${conversationId}`,
  );
  return null;
}

/**
 * POST /webhook/status
 * Webhook for call status updates
 */
app.post('/webhook/status', (req, res) => {
  const { CallSid, CallStatus, From, To, ConversationSid, ConversationStatus } =
    req.body;

  console.log(`Call status update: ${CallSid} - ${CallStatus}`);
  console.log(
    `Conversation status update: ${ConversationSid} - ${ConversationStatus}`,
  );
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
 * GET /api/conversation/:conversationSid
 * Get status of a specific conversation
 */
app.get('/api/conversation/:conversationSid', (req, res) => {
  const { conversationSid } = req.params;

  if (activeConversations.has(conversationSid)) {
    res.json(activeConversations.get(conversationSid));
  } else {
    res.status(404).json({ error: 'Conversation not found' });
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
    activeInteractions: activeInteractions.size,
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

app.post('/webhook/conversation-v1-event', (req, res) => {
  // Handle Conversation API v1 event webhook
  console.log(
    'Flex Conversation Service event webhook received:',
    JSON.stringify(req.body, null, 2),
  );

  const event = req.body;

  if (event) {
    // Handle onMessageAdded event
    // this is only here to do the initial mapping of Conversation Orchestrator conversation id to Flex ConversationSid for non-voice channels
    if (event.EventType === 'onMessageAdded') {
      const { ConversationSid, Body, Author, Source } = event;

      // Check if this ConversationSid is already mapped - if so, skip processing
      const alreadyMapped = Array.from(
        conversationIdToConversationSid.values(),
      ).includes(ConversationSid);
      if (alreadyMapped) {
        console.log(
          `ℹ️  ConversationSid ${ConversationSid} is already mapped, skipping message storage`,
        );
        return res.sendStatus(200);
      }

      // Initialize participants map for this conversation if needed
      if (!conversationv1Messages.has(ConversationSid)) {
        conversationv1Messages.set(ConversationSid, new Map());
        console.log(
          `👥 Created new messages map for v1 conversation: ${ConversationSid}`,
        );
      }

      // Add message to the map (keyed by Author)
      const messages = conversationv1Messages.get(ConversationSid);
      messages.set(Author, {
        message: Body,
        channel: Source,
      });

      console.log(
        `💬 Added message from ${Author} to conversation ${ConversationSid}:`,
        Body,
      );
    }
  }

  res.sendStatus(200);
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
      const { conversationId, author, content } = event.data;
      if (content && content.type === 'TRANSCRIPTION') {
      }
      if (content && content.type === 'TEXT') {
        // Find or create mapping between conversationId and conversationSid
        const existingConversationSid = findOrCreateConversationMapping(
          conversationId,
          author,
          content.text,
        );

        if (existingConversationSid) {
          if (!liveConversationData.has(existingConversationSid)) {
            liveConversationData.set(existingConversationSid, {
              transcript: [],
              operatorResults: [],
              startTime: new Date(),
              conversationId: existingConversationSid,
              accountId: event.AccountSid,
              intelligenceConfiguration: null,
            });
            console.log(
              `📝 Created new conversation data for key: ${existingConversationSid}`,
            );
          } else {
            console.log(
              `📝 Found existing conversation data for key: ${existingConversationSid}`,
            );
          }

          const conversationData = liveConversationData.get(
            existingConversationSid,
          );
          if (conversationData) {
            const speaker =
              author.address === TWILIO_FLEX_PHONE_NUMBER
                ? 'agent'
                : 'customer';
            const transcriptEntry = {
              timestamp: new Date().toISOString(),
              speaker: speaker,
              text: content.text || '',
            };
            conversationData.transcript.push(transcriptEntry);
            console.log(
              `Added ${speaker} transcript entry for conversation ${id}:`,
              transcriptEntry,
            );

            // Broadcast to SSE clients
            broadcastToClients(existingConversationSid, {
              type: 'transcript',
              data: transcriptEntry,
            });
          } else {
            console.warn(
              `No conversation data found for conversation ${id} when adding transcript`,
            );
          }
        }
      }
    }

    // Handle CONVERSATION_UPDATED event
    if (event.eventType === 'CONVERSATION_UPDATED') {
      const { id, status } = event.data;
      if (status === 'CLOSED') {
        // clean up maps
        const existingConversationSid =
          conversationIdToConversationSid.get(conversationId);
        if (existingConversationSid) {
          conversationv1Messages.delete(existingConversationSid);
        }
        conversationIdToConversationSid.delete(id);
        liveConversationData.delete(id);
      }
    }
  }
  res.sendStatus(200);
});

app.post('/webhook/transcript', (req, res) => {
  console.log(
    'Transcript webhook received:',
    JSON.stringify(req.body, null, 2),
  );

  const event = req.body;

  if (event) {
    const callSid = event.CallSid;
    // Initialize conversation data if needed
    if (!liveConversationData.has(callSid)) {
      liveConversationData.set(callSid, {
        transcript: [],
        operatorResults: [],
        startTime: new Date(),
        conversationId: callSid,
        accountId: event.AccountSid,
        intelligenceConfiguration: null,
      });
      console.log(`📝 Created new conversation data for key: ${callSid}`);
    } else {
      console.log(`📝 Found existing conversation data for key: ${callSid}`);
    }

    const TranscriptionData = JSON.parse(event.TranscriptionData || '{}');
    const speaker = event.Track === 'inbound_track' ? 'customer' : 'agent';

    const conversationData = liveConversationData.get(callSid);
    if (conversationData) {
      const transcriptEntry = {
        timestamp: new Date().toISOString(),
        speaker: speaker,
        text: TranscriptionData.transcript || '',
      };
      conversationData.transcript.push(transcriptEntry);
      console.log(
        `Added ${speaker} transcript entry for call ${callSid}:`,
        transcriptEntry,
      );

      // Broadcast to SSE clients
      broadcastToClients(callSid, {
        type: 'transcript',
        data: transcriptEntry,
      });
    } else {
      console.warn(
        `No conversation data found for callSid ${callSid} when adding transcript`,
      );
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
    let conversationSid = conversationIdToConversationSid.get(conversationId);

    console.log(`\n🔗 Checking conversationId mapping:`);
    console.log(`   - conversationId: ${conversationId}`);
    console.log(`   - Mapped callSid: ${callSid || 'NOT FOUND'}`);
    console.log(
      `   - Mapped conversationSid: ${conversationSid || 'NOT FOUND'}`,
    );
    console.log(
      `   - Available mappings:`,
      Array.from(conversationIdToCallSid.entries()),
    );
    console.log(
      `   - Available conversation data keys:`,
      Array.from(liveConversationData.keys()),
    );

    const haveFlexMapping = callSid || conversationSid;

    // Create session ID for SSE clients based on channel type
    let sessionId = null;
    if (haveFlexMapping) {
      // Voice channel uses callSid, digital channels use conversationSid
      sessionId = callSid || conversationSid;
      console.log(
        `📡 Session ID for SSE: ${sessionId} (${callSid ? 'voice' : 'digital'} channel)`,
      );
    }

    // IMPORTANT: callSid is ONLY available in the referenceIds field of CINTEL v3 webhooks
    // It is NOT available in the ConversationRelay WebSocket setup message
    // We must extract it from the referenceIds array to link conversationId to callSid
    if (!haveFlexMapping && operatorResults && operatorResults.length > 0) {
      console.log(`\n🔍 Attempting to extract identifier from webhook data...`);

      // Check referenceIds for callSid (starts with "CA")
      // Use the LAST callSid in the list if multiple exist
      for (const opResult of operatorResults) {
        if (opResult.referenceIds && Array.isArray(opResult.referenceIds)) {
          const callSids = opResult.referenceIds.filter((ref) =>
            ref.startsWith('CA'),
          );
          if (callSids.length > 0) {
            callSid = callSids[callSids.length - 1]; // Take the last one
            console.log(
              `✅ Found callSid in referenceIds: ${callSid}${callSids.length > 1 ? ` (${callSids.length} found, using last)` : ''}`,
            );
            // Create the mapping for future webhooks
            conversationIdToCallSid.set(conversationId, callSid);
            console.log(
              `✅ Auto-created mapping: ${conversationId} -> ${callSid}`,
            );
            break;
          } else {
            if (opResult.referenceIds.length > 0) {
              const smsSids = opResult.referenceIds.filter((ref) =>
                ref.startsWith('SM'),
              );
              if (smsSids.length > 0) {
                console.log(
                  `ℹ️  Found SMS SID(s) in referenceIds, but no callSid: ${smsSids.join(', ')}`,
                );
              }
            }
          }
        }
      }
    }

    if (!haveFlexMapping) {
      console.warn(
        `⚠️  No Flex mapping found for conversationId: ${conversationId}`,
      );
      console.warn(
        `⚠️  Without mapping, operator results won't appear in the UI!`,
      );
    } else {
      console.log(
        `✅ Using identifier: ${callSid} or ${conversationSid} for this conversation`,
      );
    }

    // Use callSid if available, otherwise use conversationId as the key
    const dataKey = callSid || conversationSid || conversationId;
    console.log(`   - Using data key: ${dataKey}`);

    // Initialize conversation data if needed
    if (!liveConversationData.has(dataKey)) {
      liveConversationData.set(dataKey, {
        transcript: [],
        operatorResults: [],
        startTime: new Date(),
        conversationId,
        accountId,
        intelligenceConfiguration,
      });
      console.log(`📝 Created new conversation data for key: ${dataKey}`);
    } else {
      console.log(`📝 Found existing conversation data for key: ${dataKey}`);
    }

    // If we just found a callSid mapping and there's data under conversationId, migrate it
    if (
      callSid &&
      dataKey === callSid &&
      liveConversationData.has(conversationId) &&
      conversationId !== callSid
    ) {
      console.log(`\n🔄 Migrating data from conversationId to callSid...`);
      const oldData = liveConversationData.get(conversationId);
      const newData = liveConversationData.get(callSid);

      // Merge operator results
      if (oldData.operatorResults && oldData.operatorResults.length > 0) {
        console.log(
          `   - Migrating ${oldData.operatorResults.length} operator results`,
        );
        newData.operatorResults = [
          ...newData.operatorResults,
          ...oldData.operatorResults,
        ];

        // Update metadata
        newData.conversationId = conversationId;
        newData.accountId = accountId;
        newData.intelligenceConfiguration = intelligenceConfiguration;

        // Delete old data
        liveConversationData.delete(conversationId);
        console.log(`✅ Migration complete. Deleted old conversationId key.`);
      }
    }

    //TODO: probably can optimize this pattern to be channel-agnostic
    // If we just found a conversationSid mapping and there's data under conversationId, migrate it
    if (
      conversationSid &&
      dataKey === conversationSid &&
      liveConversationData.has(conversationId) &&
      conversationId !== conversationSid
    ) {
      console.log(
        `\n🔄 Migrating data from conversationId to conversationSid...`,
      );
      const oldData = liveConversationData.get(conversationId);
      const newData = liveConversationData.get(conversationSid);

      // Merge operator results
      if (oldData.operatorResults && oldData.operatorResults.length > 0) {
        console.log(
          `   - Migrating ${oldData.operatorResults.length} operator results`,
        );
        newData.operatorResults = [
          ...newData.operatorResults,
          ...oldData.operatorResults,
        ];
      }

      // Update metadata
      newData.conversationId = conversationId;
      newData.accountId = accountId;
      newData.intelligenceConfiguration = intelligenceConfiguration;

      // Delete old data
      liveConversationData.delete(conversationId);
      console.log(`✅ Migration complete. Deleted old conversationId key.`);
    }

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
        if (sessionId) {
          console.log(
            `      - ✅ Broadcasting to SSE clients for sessionId: ${sessionId}`,
          );
          broadcastToClients(sessionId, {
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
 * POST /api/link-conversation
 * Manually link a CINTEL conversationId to a callSid
 */
app.post('/api/link-conversation', (req, res) => {
  try {
    const { conversationId, callSid } = req.body;

    if (!conversationId || !callSid) {
      return res.status(400).json({
        error: 'Both conversationId and callSid are required',
      });
    }

    conversationIdToCallSid.set(conversationId, callSid);
    console.log(
      `Linked conversationId ${conversationId} to callSid ${callSid}`,
    );

    // If there's existing data under conversationId, migrate it to callSid
    if (liveConversationData.has(conversationId)) {
      const data = liveConversationData.get(conversationId);
      liveConversationData.set(callSid, data);
      liveConversationData.delete(conversationId);
      console.log(`Migrated data from conversationId to callSid`);
    }

    res.json({
      success: true,
      message: 'Conversation linked successfully',
    });
  } catch (error) {
    console.error('Error linking conversation:', error);
    res.status(500).json({ error: 'Failed to link conversation' });
  }
});

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
    'OPENAI_API_KEY',
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
