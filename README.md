# Conversational Intelligence With Flex Plug-in Demo

A full-stack application for **Twilio Conversational Intelligence** - the AI-powered communication analysis product and and **Twilio Flex** - the flexible contact center platform. This demo allows you to test conversation analysis capabilities by simulating customer calls where:

- **Flex** where the human agent assists the customer
- **Conversational Intelligence** analyzes the conversation in real-time and provides script adherence assistance to the human agent

## Architecture

- **Frontend**: Twilio Flex Plug-in (React, Typescript)
- **Backend**: Express.js HTTP server
- **Conversation Orchestrator**: Twilio's orchestrator used to observe channel "exhaust" and gather communications data
- **Analysis**: Conversational Intelligence analyzes the conversation in real-time with language operators

## Prerequisites

- Node.js 18+ installed
- A Twilio account ([Sign up here](https://www.twilio.com/try-twilio)) on the latest Console version with access to latest Twilio Conversations
- ngrok or similar tunnel tool for local WebSocket/webhook access
- Twilio CLI with Serverless and Plug-ins configured to your account

## Setup Instructions

### 1. Install Dependencies

#### Backend (Server)

```bash
cd server
npm install
```

#### Frontend (Web)

```bash
cd plugin-cintel-rtt
npm install
```

### 2. Configure Twilio Console

You'll need to set up several resources in your Twilio Console:

#### A. Get Account Credentials

1. Go to [Twilio Console](https://console.twilio.com/)
2. Copy your **Account SID** and **Auth Token**

#### B. Create API Key

1. Navigate to [API Keys](https://1console.twilio.com/account/ACxxx/settings/us1/api-keys/list)
2. Click "Create API Key"
3. Give it a name (e.g., "CIntel Plugin Key")
4. Copy the **API Key SID** and **API Secret** (you won't be able to see the secret again!)

#### C. Verified Phone Numbers - Toll Free preferred

If you already have a Flex account with a Voice IVR configured, you can use the existing
number for one of them. This number goes in the Server Environment Variables. For voice this doesn't need to be verified,
but if you plan to use SMS you will need a verified number.

1. Go to [Numbers & Senders/Phone Numbers](https://1console.twilio.com/account/ACxxx/us1/senders-hub/list/phone-numbers/inventory)
2. Purchase a phone number with Voice capabilities
3. Copy the phone number in E.164 format (e.g., +1234567890)

You'll need this number for Environment Variables in the Server project.

### 3. Configure Environment Variables

If you have a custom ngrok domain, you can set it now. Otherwise you will need to start your tunnel and get the url first.

Edit `/server/.env` with your environment information:

```bash
# Twilio Account Credentials
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here

# Twilio API Key & Secret
TWILIO_API_KEY=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_SECRET=your_api_secret_here

# Twilio Flex Phone Number (E.164 format)
TWILIO_FLEX_PHONE_NUMBER=+12345678900

# Server Configuration
# IMPORTANT: Use HTTPS URL (ngrok provides this)
SERVER_URL=https://your-ngrok-url.ngrok.app
```

### 4. Set Up Webhooks with ngrok

Since Twilio needs to send webhooks and WebSocket connections to your local server, you need to expose it publicly using ngrok.

#### Start ngrok

```bash
ngrok http 3001
```

or if you have a custom domain

```bash
ngrok http --url=your-ngrok-url.ngrok.app 3001
```

You should see output like:

```
Forwarding  https://abc123def456.ngrok.io -> http://localhost:3001
```

**Important**: Copy the **HTTPS URL** (e.g., `https://your-ngrok-url.ngrok.app`) - you'll need it for the next steps.

#### Update Your Environment Variables (if necessary)

1. Open `/server/.env`
2. Update `SERVER_URL` with your ngrok HTTPS URL:
   ```bash
   SERVER_URL=https://your-ngrok-url.ngrok.app
   ```
3. Save the file

#### Configure Flex Voice inbound number

Find the inbound phone number used for Flex voice calls and update the status callback.

POST to https://your-ngrok-url.ngrok.app/webhook/status

This is used to keep track of active calls in the server and tear down some mappings when the call ends.

#### Verify Your Setup

Check that all webhook endpoints are configured:

- **Status Callbacks** (start-call and voice number): `/webhook/status` (for call status updates)

**Note**: Every time you restart ngrok, you'll get a new URL and need to update these settings. Consider upgrading to ngrok's paid plan for a permanent URL, or use a cloud deployment.

### 5. Run the Application

#### Start Backend Server

```bash
cd server
npm run dev
```

The server should start on `http://localhost:3001`

Make sure nGrok is running as described previously.

#### Start Flex Plug-in (in a new terminal)

If you want to test the plug-in locally first

```bash
cd plugin-cintel-rtt
twilio flex:plugins:start
```

The web app should start on `http://localhost:3000`

To deploy the plug-in

This plug-in uses a Webpack configuration that utilizes Environment Variables to avoid hardcoding Functions Service
and backend service endpoints directly into the plug-in.

Change the **FlexDemo** condition in the switch statement in your webpack.config.js to match the active Profile
you are using with the Twilio CLI. Use the profiles list command below to confirm you are targeting the correct
Flex hosted environment.

Create an **.env.production** file with the following values:

```bash
REACT_APP_BACKEND_URL=https://your-ngrok-url.ngrok.app
```

replace the profile name with your profile name

```bash
twilio profiles:list
twilio flex:plugins:deploy --profile=FlexDemo --changelog "Initial" --description "Flex CIntel3 plugin"
```

When the deployment completes, copy the _:release_ command and run it.

### 6. Configure Conversation Intelligence Webhooks for Real-time Operator Results

To see real-time operator results in the UI, you need to configure Conversation Intelligence to send webhooks to your server:

#### What You'll See:

- **Live Transcript**: Real-time transcription of your conversation (agent vs customer) from Conversation Orchestrator
- **Operator Results**: Real-time CINTEL analysis (sentiment, intent, topics, custom operators)

#### Configuration Steps:

You can also perform the following steps using the Twilio Console UI if you prefer.

1. **Create Conversation Intelligence configuration**

```bash
curl --location 'https://intelligence.twilio.com/v3/ControlPlane/Configurations' \
--H 'Content-Type: application/json' \
-u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
--data '{
    "displayName": "flex_cintel_plugin_demo",
    "description": "Configuration for Flex plugin demoing built-in operators",
    "rules": []
  }'

```

Get the configuration id from this operation as you'll need it to update the rules. This creates an empty
configuration with no rules added yet.

2. **Create Conversation Intelligence Rules for this demo**:

For the specific script adherence included in this demo, you will need
to configure the built in Script-adherence operator provided by Twilio.

This rule set also includes a second set of operators (sentiment and summary)
that trigger on every 5 communications. This provides frequent updates to the agent around
these insights during a live call.

Replace the configuration id in the curl below with your id from above.

```bash
curl --location --request PUT 'https://intelligence.twilio.com/v3/ControlPlane/Configurations/intelligence_configuration_xxx' \
--H 'Content-Type: application/json' \
-u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
--data '{
    "displayName": "flex_cintel_plugin_demo",
    "description": "Configuration for Flex plugin demoing built-in operators.",
    "rules": [
        {
            "actions": [
                {
                    "method": "POST",
                    "type": "WEBHOOK",
                    "url": "https://your-ngrok-url.ngrok.app/webhook/cintel-action"
                }
            ],
            "context": {
                "knowledge": null,
                "memory": {
                    "enabled": true
                }
            },
            "operators": [
                {
                    "id": "intelligence_operator_01kf34tcyefpyb1t4m0nbd8rxg",
                    "parameters": {
                        "script": "Category: Greetings] \nAction: Greet the customer with business name and agent name. \nRequired Phrase: \"Thanks for contacting {company name}. This is {agent_name}.\"  \nScore weight:10%\n\n[Category: Verification] \nGoal: Confirm identity quickly\nAction: Capture customer move date and to/from cities within first 50 seconds of conversation.\nScore weight:20%\n\n[Category: Move Details]\nGoal: Confirm move details and answer questions\nAction: Agent collects details about the customer's move, including special items, international moves, customs, and insurance options\nScore weight:40%\n\n[Category: Confirmation]\nGoal: Next Steps\nAction: Agent summarizes next steps (preferred channel, video walkthrough)\nScore weight:30%"
                    },
                    "version": null
                }
            ],
            "triggers": [
                {
                    "on": "COMMUNICATION",
                    "parameters": {
                        "count": 1
                    }
                }
            ]
        },
        {
            "actions": [
                {
                    "method": "POST",
                    "type": "WEBHOOK",
                    "url": "https://your-ngrok-url.ngrok.app/webhook/cintel-action"
                }
            ],
            "context": {
                "knowledge": null,
                "memory": {
                    "enabled": true
                }
            },
            "operators": [
                {
                    "id": "intelligence_operator_01kcrvw16kfa88qvgrfmr7y151",
                    "parameters": null,
                    "version": null
                },
                {
                    "id": "intelligence_operator_01kcv35pnkeysaf6z6cqtbpegn",
                    "parameters": null,
                    "version": null
                }
            ],
            "triggers": [
                {
                    "on": "COMMUNICATION",
                    "parameters": {
                        "count": 5
                    }
                }
            ]
        }
    ]
  }'
```

3. **Update Conversation Orchestrator: Conversation Configuration**:

You will need a Conversation Configuration with capture rules configured to listen for Flex calls. You can use an existing one if you've already created one. To create a new configuration, use POST and leave out YOUR_CONVERSATION_CONFIGURATION_ID.

Example:

Replace the values below for your phone number in voice capture rules, your intelligence configuration id, your memory store id
and your status callback url. If you don't have all of these values yet, you can update this configuration by using
**PUT** and including your **conf_configuration_xxx** id. See API docs for additional information.

```bash
curl -X POST "https://conversations.twilio.com/v2/ControlPlane/Configurations/" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "channelSettings": {
        "VOICE": {
            "captureRules": [
                {
                    "from": "*",
                    "metadata": {},
                    "to": "+1234567890"
                },
                {
                    "from": "+1234567890",
                    "metadata": {},
                    "to": "*"
                }
            ],
            "statusTimeouts": null
        }
    },
    "conversationGroupingType": "GROUP_BY_PARTICIPANT_ADDRESSES_AND_CHANNEL_TYPE",
    "description": "Analyze calls using real-time CIntel V3",
    "displayName": "flex-cintelv3",
    "intelligenceConfigurationIds": [
        "intelligence_configuration_xxx"
    ],
    "memoryExtractionEnabled": true,
    "memoryStoreId": "mem_store_xxx",
    "statusCallbacks": [
        {
            "method": "POST",
            "url": "https://your-ngrok-url.ngrok.app/webhook/cor-event"
        }
    ]
}'

```

4. **Verify Configuration**:
   Check that the webhook action was added successfully:

   ```bash
   curl -X GET "https://intelligence.twilio.com/v3/ControlPlane/Configurations/YOUR_CONFIGURATION_ID" \
     -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" | jq .
   ```

5. **Test It**:
   - Make a test call
   - Watch the **CINTEL Operator Results** panel (right side)
   - You'll see operator results appear in real-time as CINTEL analyzes the conversation

#### Understanding the Configuration:

- **`operators`**: Array of CINTEL operators to run (sentiment, intent, custom operators, etc.)
- **`triggers`**: When to run operators (`COMMUNICATION` = every utterance)
- **`actions`**: What to do with results (`WEBHOOK` = send to your server in real-time)
- **Multiple operators**: You can add multiple operators to track different insights simultaneously

#### What Gets Sent:

CINTEL v3 will POST **Rule Execution** webhooks to `/webhook/cintel-action` with the following structure:

```json
{
  "accountId": "ACxxxx",
  "conversationId": "conv_conversation_772a49ae-48e7-4d18-9db5-a40f6203de01",
  "intelligenceConfiguration": {
    "id": "intelligence_configuration_xxx",
    "friendlyName": "Real-time Sentiment Analyzer",
    "version": 1,
    "ruleId": "intelligence_configurationrule_xxx"
  },
  "operatorResults": [
    {
      "id": "intelligence_operatorresult_xxx",
      "operator": {
        "id": "LY6bdafd206f3d4146b13f45bf415ca363",
        "friendlyName": "Sentiment Analysis Operator",
        "version": 2,
        "parameters": { "model": "sentiment-v2" }
      },
      "outputFormat": "JSON",
      "result": {
        "label": "positive",
        "score": 0.85
      },
      "dateCreated": "2025-12-11T12:33:36.143498Z",
      "referenceIds": [],
      "executionDetails": {
        "trigger": {
          "on": "COMMUNICATION",
          "timestamp": "2025-12-11T12:33:35.987654Z"
        },
        "communications": {
          "first": "conv_communication_00000000000000000000000000",
          "last": "conv_communication_00000000000000000000000001"
        },
        "channels": ["SMS"],
        "participants": [
          {
            "id": "conv_participant_00000000000000000000000000",
            "profileId": "mem_profile_00000000000000000000000000",
            "type": "HUMAN_AGENT"
          }
        ],
        "context": {}
      }
    }
  ]
}
```

### 7. Test the Application

If everything is working correctly, you should have activity in the 3 tabs of the plug-in. This assumes you have also completed
step 7.

- Tab 1 - Transcript - should show the conversation transcript live
- Tab 2 - Agent View - shows Script Adherence interface and steps should be marked off as call progresses
- Tab 3 - Operator Result Log - will show language operator results as they are streamed to the plug-in

1. Open your browser to `http://localhost:3000` or open your hosted Flex instance `https://flex.twilio.com`
2. Call your Flex phone number to start the customer call
3. Make sure you are marked **Available** to receive Tasks.
4. If everything is configured correctly, you should receive an inbound Voice Task in Flex:
   - You (the business agent in the browser) ↔ caller (or SMS sender)
   - Conversational Intelligence analyzes your conversation in real-time
   - transcript and language operator events are streamed to the plug-in
5. If you have Unified Profiles component enabled, switch to the **In-house** tab to view the plug-in.
6. Start by introducing yourself. Speak naturally as if you're a business agent helping a customer
7. The person acting as caller should respond naturally to your questions and statements
8. Click **"Hang Up"** when done to end the analysis session

**Key CINTEL v3 Payload Fields:**

- `conversationId`: Unique ID for the conversation (links to Twilio Conversations)
- `intelligenceConfiguration`: Metadata about the Intelligence Configuration that generated results
- `operatorResults`: Array of operator results (can contain multiple operators per webhook)
- Each operator result includes:
  - `operator.friendlyName`: Name of the operator
  - `outputFormat`: Result type (TEXT, JSON, CLASSIFICATION, EXTRACTION)
  - `result`: The actual analysis result (structure varies by outputFormat)
  - `executionDetails`: Context about when/how the operator executed

**ConversationId Mapping:**

CINTEL webhooks use `conversationId` to identify conversations, while the call uses `callSid`. The server automatically links them using the **`referenceIds` field in the webhook payload**:

- **Automatic Mapping**: The server extracts the `callSid` (starts with "CA") from the `referenceIds` array in each operator result
- **Example**: `"referenceIds": ["CA0f6075822b8e56abe422b2cc2e9f5b39"]` → callSid is `CA0f60...`
- **Once found**: The mapping is cached for the session, and all subsequent webhooks use it
- **Data Migration**: If operator results were stored under `conversationId` before the mapping was found, they're automatically migrated to `callSid`

If a transcript is received on the Conversation Orchestrator webhook before the mapping is confirmed, it will be saved
in a temporary map and sent later.

The server will:

- Parse the CINTEL operators payload structure
- Auto-extract callSid from referenceIds
- Create conversationId → callSid mapping
- Migrate any existing data stored under conversationId
- Extract all operator results from the array
- Store them with full metadata (operator name, version, execution details)
- Broadcast via Server-Sent Events (SSE) to the frontend
- Display in real-time in the right panel with trigger info and channels

## How It Works

### Call Flow & Roles

- **You** = Contact center agent (being analyzed)
- **Conversational Intelligence** = Analysis engine (testing target)

### Technical Flow

1. **Inbound Call Initiated**" to the Flex account
2. **Studio sends call (Task) to Flex** routing call to agent. Plug-in establishes SSE client to communicate with server.
3. **Conversation Orchestrator webhook** sends back to server, where speech is parsed and sent to Flex plug-in via SSE.
4. **Conversational Intelligence analyzes** the agent conversation based on custom agent adherence language operator
5. **You interact naturally** with the caller to test analysis capabilities
6. **Language Operator events** drive completion of Agent Adherence steps in customized plug-in

### Key Endpoints

#### Backend (Express HTTP)

- `GET /api/stream/:sessionId` - **Server-Sent Events (SSE)** stream for real-time updates (handles both Call SIDs for voice and Conversation SIDs for digital channels)
- `POST /webhook/status` - Call status updates
- `POST /webhook/cintel-action` - **CINTEL v3 operator results webhook**
- `POST /webhook/cor-event` - transcript based on Conversation Configuration
- `GET /health` - Health check

## Project Structure

```
flex-cintelv3-agentassistance/
├── README.md                           # This file - project documentation
│
├── plugin-cintel-rtt/                  # Twilio Flex Plugin (React/TypeScript)
│   ├── package.json                    # Plugin dependencies
│   ├── tsconfig.json                   # TypeScript configuration
│   ├── webpack.config.js               # Webpack build configuration
│   ├── jest.config.js                  # Jest test configuration
│   ├── README.md                       # Plugin-specific documentation
│   ├── .env.production                 # Plugin environment variables sample file for specific Flex profile
│   ├── public/                         # Static configuration files
│   │   ├── appConfig.example.js        # Example app configuration
│   │   ├── appConfig.js                # App configuration

│   └── src/                            # Plugin source code
│       ├── index.ts                    # Plugin entry point
│       ├── CintelRttPlugin.tsx         # Main plugin component
│       └── components/
│           ├── CIntelPanel.tsx         # Main panel container
│           ├── TranscriptPanel.tsx     # Live transcript display
│           ├── ScriptAdherence.tsx     # Script adherence UI
│           ├── OperatorResultLog.tsx   # CINTEL operator results display
│       └── config/
│           ├── scriptDimensions.json   # Script adherence dimensions
└── server/                             # Express Backend (WebSocket + HTTP)
    ├── index.js                        # Main server with ConversationRelay
    ├── package.json                    # Backend dependencies
    └── .env.example                    # Server environment variables example file
```

## Troubleshooting

### Webhooks not working

- Make sure ngrok is running and the URL is updated in:
  - `/server/.env` (SERVER_URL)
  - Twilio Phone Number configuration
- Check that your ngrok URL uses HTTPS (required by Twilio)
- Verify webhook URLs end with the correct paths

### No audio or connection issues

- Check browser permissions for microphone access
- Check the backend server logs for errors
- Ensure your firewall allows WebRTC connections

### No CIntel callbacks received in web client

- Confirm you have set up correct capture rules in your Conversation Configuration
- Confirm your custom language operator matches the expected behavior of the `Agent View` panel

## Development Notes

- The application uses ES Modules (`"type": "module"`) in the backend
- CORS is configured to allow requests from `localhost:3000` and `flex.twilio.com`
- Call and conversation state is stored in memory (use a database for production)
- Conversational Intelligence analysis can be viewed in the Twilio Console during/after calls

## Resources

- [Twilio Conversational Intelligence Documentation](https://www.twilio.com/docs/voice/intelligence)
- [CINTEL v3 API Reference](https://intelligence.twilio.com/v3/ControlPlane) - Configurations, Operators, Rules
- [Twilio Voice SDK Documentation](https://www.twilio.com/docs/voice/sdks/javascript)
- [Twilio Flex Plug-ins Documentation](https://www.twilio.com/docs/flex/developer/ui-and-plugins)

## Disclaimer

This software is to be considered "sample code", a Type B Deliverable, and is delivered "as-is" to the user. Twilio bears no responsibility to support the use or implementation of this software.

## License

MIT
