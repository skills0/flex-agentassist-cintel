'use client';

import { useState, useEffect, useRef } from 'react';
import ScriptAdherence from './ScriptAdherence';
import OperatorResultLog from './OperatorResultLog';
import TranscriptPanel, { TranscriptEntry } from './TranscriptPanel';
import { Button } from '@twilio-paste/core/';
import { AgentIcon } from '@twilio-paste/icons/esm/AgentIcon';

type PluginConfig = {
  serverless_function_base: string;
  backend_server: string;
};

type OperatorResult = {
  id?: string;
  timestamp: string;
  conversationId?: string;
  operator:
    | string
    | {
        id?: string;
        friendlyName: string;
        version?: number;
        parameters?: Record<string, any>;
      };
  outputFormat?: 'TEXT' | 'JSON' | 'CLASSIFICATION' | 'EXTRACTION';
  result: any;
  referenceIds?: string[];
  executionDetails?: {
    trigger?: {
      on: 'COMMUNICATION' | 'CONVERSATION_END';
      timestamp: string;
    };
    communications?: {
      first: string | null;
      last: string | null;
    };
    channels?: string[];
    participants?: Array<{
      id: string;
      profileId: string;
      type: 'HUMAN_AGENT' | 'CUSTOMER' | 'AI_AGENT';
    }>;
    context?: Record<string, any>;
  };
  rawPayload?: any;
};

interface CINTELPanelProps {
  manager: any;
  task: any;
}

type TabType = 'transcript' | 'agent-view' | 'operator-log';

// manager: Flex Manager, task: Flex Task
// You will need to extract callSid or other identifiers from task as needed for SSE
export default function CINTELPanel({ manager, task }: CINTELPanelProps) {
  const callSid = task?.attributes?.call_sid;
  const conversationSid = task?.attributes?.conversationSid;
  const channel =
    task?.attributes?.channelType == 'voice' ? 'voice' : 'digital';
  const [activeTab, setActiveTab] = useState<TabType>('transcript');
  const [unreadCount, setUnreadCount] = useState(0);
  const previousCountRef = useRef(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [operatorResults, setOperatorResults] = useState<OperatorResult[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Server URL from environment or default
  const serverUrl = process.env.REACT_APP_BACKEND_URL || '';

  // Log URLs only on first load
  useEffect(() => {
    console.log('CINTELPanel: Using server URL:', serverUrl);

    console.log(
      'CINTELPanel: Found server URL in .env:',
      process.env.REACT_APP_SERVERLESS_BASE_URL,
    );

    console.log('Active task channel type:', channel);
  }, []);

  // SSE connection for transcript and operator results
  useEffect(() => {
    if (!callSid && !conversationSid) return;

    // Clean up previous connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sessionId = channel === 'voice' ? callSid : conversationSid;

    const eventSource = new EventSource(`${serverUrl}/api/stream/${sessionId}`);

    console.log(
      `CINTELPanel: Establishing SSE connection to ${eventSource.url}`,
    );

    eventSource.onopen = () => {
      // Connection established
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case 'initial':
            if (data.transcript) setTranscript(data.transcript);
            if (data.operatorResults) setOperatorResults(data.operatorResults);
            break;
          case 'transcript':
            setTranscript((prev) => [...prev, data.data]);
            break;
          case 'operator-result':
            setOperatorResults((prev) => [...prev, data.data]);
            break;
          default:
            break;
        }
      } catch (error) {
        // Handle parse error
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    eventSourceRef.current = eventSource;

    return () => {
      eventSource.close();
    };
  }, [callSid, conversationSid, channel, serverUrl]);

  // Track new operator results and update badge count
  useEffect(() => {
    if (operatorResults.length > previousCountRef.current) {
      if (activeTab !== 'operator-log') {
        const newResults = operatorResults.length - previousCountRef.current;
        setUnreadCount((prev) => prev + newResults);
      }
    }
    previousCountRef.current = operatorResults.length;
  }, [operatorResults, activeTab]);

  // Clear unread count when switching to operator log tab
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    if (tab === 'operator-log') {
      setUnreadCount(0);
    }
  };

  return (
    <div
      style={{
        background: 'white',
        borderRadius: '8px',
        padding: '0',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Tab Navigation - Only show when there's an active task */}
      {(callSid || conversationSid) && (
        <div
          style={{
            display: 'flex',
            borderBottom: '2px solid #e5e7eb',
            backgroundColor: '#f9fafb',
          }}
        >
          <button
            onClick={() => handleTabChange('transcript')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 12px',
              fontSize: '12px',
              fontWeight: '600',
              color: activeTab === 'transcript' ? '#1f2937' : '#6b7280',
              backgroundColor:
                activeTab === 'transcript' ? 'white' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'transcript'
                  ? '2px solid #3b82f6'
                  : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
            }}
            onMouseOver={(e) => {
              if (activeTab !== 'transcript') {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== 'transcript') {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            Transcript
          </button>

          <button
            onClick={() => handleTabChange('agent-view')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 12px',
              fontSize: '12px',
              fontWeight: '600',
              color: activeTab === 'agent-view' ? '#1f2937' : '#6b7280',
              backgroundColor:
                activeTab === 'agent-view' ? 'white' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'agent-view'
                  ? '2px solid #3b82f6'
                  : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
            }}
            onMouseOver={(e) => {
              if (activeTab !== 'agent-view') {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== 'agent-view') {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            Agent View
          </button>

          <button
            onClick={() => handleTabChange('operator-log')}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '10px 12px',
              fontSize: '12px',
              fontWeight: '600',
              color: activeTab === 'operator-log' ? '#1f2937' : '#6b7280',
              backgroundColor:
                activeTab === 'operator-log' ? 'white' : 'transparent',
              border: 'none',
              borderBottom:
                activeTab === 'operator-log'
                  ? '2px solid #3b82f6'
                  : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.2s',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
            onMouseOver={(e) => {
              if (activeTab !== 'operator-log') {
                e.currentTarget.style.backgroundColor = '#f3f4f6';
              }
            }}
            onMouseOut={(e) => {
              if (activeTab !== 'operator-log') {
                e.currentTarget.style.backgroundColor = 'transparent';
              }
            }}
          >
            <span>Operator Result Log</span>
            {unreadCount > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minWidth: '20px',
                  height: '20px',
                  padding: '0 6px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: '700',
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Tab Content */}
      {(callSid || conversationSid) && (
        <div
          style={{
            padding: '16px',
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {activeTab === 'agent-view' && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                width: '100%',
                maxWidth: '800px',
                boxSizing: 'border-box',
              }}
            >
              <ScriptAdherence operatorResults={operatorResults} />
            </div>
          )}
          {activeTab === 'operator-log' && (
            <div
              style={{
                width: '100%',
                maxWidth: '800px',
                boxSizing: 'border-box',
              }}
            >
              <OperatorResultLog operatorResults={operatorResults} />
            </div>
          )}
          {activeTab === 'transcript' &&
            (() => {
              const getName = (op: OperatorResult['operator']) =>
                typeof op === 'string' ? op : op?.friendlyName || '';
              const latestSummary = [...operatorResults]
                .reverse()
                .find((r) =>
                  getName(r.operator).toLowerCase().includes('summary'),
                );
              const latestSentiment = [...operatorResults]
                .reverse()
                .find((r) =>
                  getName(r.operator).toLowerCase().includes('sentiment'),
                );
              const sentimentLabel: string =
                latestSentiment?.result?.label ?? '';
              const sentimentColor =
                sentimentLabel === 'positive'
                  ? '#10b981'
                  : sentimentLabel === 'negative'
                    ? '#ef4444'
                    : '#6b7280';

              return (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    width: '100%',
                    maxWidth: '800px',
                    boxSizing: 'border-box',
                  }}
                >
                  <div
                    style={{ display: 'flex', gap: '8px', overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        color: '#1f2937',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: '600',
                          color: '#6b7280',
                          marginBottom: '4px',
                          fontSize: '11px',
                        }}
                      >
                        SUMMARY
                      </div>
                      {latestSummary ? (
                        <span style={{ wordBreak: 'break-word' }}>
                          {typeof latestSummary.result === 'string'
                            ? latestSummary.result
                            : (latestSummary.result?.summary ??
                              latestSummary.result?.text ??
                              JSON.stringify(latestSummary.result))}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>Pending...</span>
                      )}
                    </div>
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#f9fafb',
                        border: '1px solid #e5e7eb',
                        fontSize: '12px',
                        minWidth: '90px',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontWeight: '600',
                          color: '#6b7280',
                          marginBottom: '4px',
                          fontSize: '11px',
                        }}
                      >
                        SENTIMENT
                      </div>
                      {latestSentiment ? (
                        <span
                          style={{
                            fontWeight: '600',
                            color: sentimentColor,
                            textTransform: 'capitalize',
                          }}
                        >
                          {sentimentLabel}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>Pending...</span>
                      )}
                    </div>
                  </div>
                  <TranscriptPanel transcript={transcript} />
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}
