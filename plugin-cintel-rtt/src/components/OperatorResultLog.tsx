'use client'

import { useState, useEffect, useRef } from 'react'

type OperatorResult = {
  id?: string
  timestamp: string
  conversationId?: string
  operator: string | {
    id?: string
    friendlyName: string
    version?: number
    parameters?: Record<string, any>
  }
  outputFormat?: 'TEXT' | 'JSON' | 'CLASSIFICATION' | 'EXTRACTION'
  result: any
  referenceIds?: string[]
  executionDetails?: {
    trigger?: {
      on: 'COMMUNICATION' | 'CONVERSATION_END'
      timestamp: string
    }
    communications?: {
      first: string | null
      last: string | null
    }
    channels?: string[]
    participants?: Array<{
      id: string
      profileId: string
      type: 'HUMAN_AGENT' | 'CUSTOMER' | 'AI_AGENT'
    }>
    context?: Record<string, any>
  }
  rawPayload?: any
}

interface OperatorResultLogProps {
  operatorResults: OperatorResult[]
}

export default function OperatorResultLog({ operatorResults }: OperatorResultLogProps) {
  const [expandedPayloads, setExpandedPayloads] = useState<Set<number>>(new Set())
  const lastLoggedCountRef = useRef(0)

  // Debug logging - only log when new results arrive
  useEffect(() => {
    if (operatorResults.length > lastLoggedCountRef.current) {
      console.log('=== CINTEL Operator Results Debug ===')
      console.log('Total results:', operatorResults.length)
      console.log('\nNote: The webhook structure from CINTEL is:')
      console.log('  Webhook Envelope: { conversationId, accountId, operatorResults: [...] }')
      console.log('  Each item in operatorResults[]: { id, operator, result, executionDetails, ... }')
      console.log('  conversationId is at the webhook level, not in each operator result\n')

      // Only log new results
      for (let index = lastLoggedCountRef.current; index < operatorResults.length; index++) {
        const result = operatorResults[index]
        console.log(`\nResult ${index}:`)
        console.log(`  Conversation ID: ${result.conversationId || 'NOT SET'} (added from webhook envelope by server)`)
        console.log(`  Operator: ${typeof result.operator === 'string' ? result.operator : result.operator?.friendlyName}`)
        console.log(`  Output Format: ${result.outputFormat || 'N/A'}`)
        console.log(`  Result:`, result.result)
        if (result.executionDetails?.communications) {
          console.log(`  Communications:`)
          console.log(`    - First: ${result.executionDetails.communications.first}`)
          console.log(`    - Last: ${result.executionDetails.communications.last}`)
        }
        if (result.rawPayload) {
          console.log(`  Raw Operator Result from CINTEL (untransformed):`, result.rawPayload)
        }
      }

      lastLoggedCountRef.current = operatorResults.length
    }
  }, [operatorResults])

  const togglePayload = (index: number) => {
    setExpandedPayloads(prev => {
      const newSet = new Set(prev)
      if (newSet.has(index)) {
        newSet.delete(index)
      } else {
        newSet.add(index)
      }
      return newSet
    })
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column'
    }}>
      <div style={{
        flex: 1,
        overflowY: 'auto',
        maxHeight: '600px',
        padding: '16px',
        backgroundColor: '#f9fafb',
        borderRadius: '8px',
        border: '1px solid #e5e7eb'
      }}>
        {operatorResults.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
            <div>Operator results will appear here in real-time...</div>
            <div style={{ fontSize: '12px', marginTop: '8px', color: '#6b7280' }}>
              Configure CINTEL webhooks to see live analysis
            </div>
          </div>
        ) : (
          <>
            {operatorResults.map((result, index) => {
              // Handle both old and new operator result formats
              const operatorName = typeof result.operator === 'string'
                ? result.operator
                : result.operator?.friendlyName || 'Unknown Operator';

              const operatorVersion = typeof result.operator === 'object'
                ? result.operator?.version
                : undefined;

              return (
                <div
                  key={result.id || index}
                  style={{
                    marginBottom: '16px',
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: '#fef3c7',
                    borderLeft: '4px solid #f59e0b'
                  }}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#92400e',
                    marginBottom: '4px'
                  }}>
                    🔍 {operatorName}
                  </div>

                  
                  {result.executionDetails?.trigger && (
                    <div style={{
                      fontSize: '10px',
                      color: '#78716c',
                      marginBottom: '8px'
                    }}>
                      Trigger: {result.executionDetails.trigger.on}
                      {result.executionDetails.channels && ` • Channels: ${result.executionDetails.channels.join(', ')}`}
                    </div>
                  )}
                  <pre style={{
                    fontSize: '12px',
                    color: '#1f2937',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    margin: 0,
                    fontFamily: 'monospace',
                    backgroundColor: '#ffffff',
                    padding: '8px',
                    borderRadius: '4px'
                  }}>
                    {JSON.stringify(result.result, null, 2)}
                  </pre>
                  {/* Conversation and Communication IDs */}
                  {(result.conversationId || result.executionDetails?.communications) && (
                    <div style={{
                      fontSize: '10px',
                      color: '#78716c',
                      marginTop: '8px',
                      padding: '8px',
                      backgroundColor: '#fef9c3',
                      borderRadius: '4px',
                      border: '1px solid #fde047'
                    }}>
                      {result.conversationId && (
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Conversation ID:</strong> {result.conversationId}
                          <span style={{ fontSize: '9px', color: '#a16207', marginLeft: '6px' }}>
                            (from webhook envelope)
                          </span>
                        </div>
                      )}
                      {result.executionDetails?.communications?.first && (
                        <div style={{ marginBottom: '4px' }}>
                          <strong>Start Communication ID:</strong> {result.executionDetails.communications.first}
                        </div>
                      )}
                      {result.executionDetails?.communications?.last && (
                        <div>
                          <strong>End Communication ID:</strong> {result.executionDetails.communications.last}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '8px' }}>
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </div>

                  {/* Debug: Raw Operator Result from CINTEL */}
                  {result.rawPayload && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                      <button
                        onClick={() => togglePayload(index)}
                        style={{
                          fontSize: '10px',
                          color: '#3b82f6',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px 0',
                          textDecoration: 'underline'
                        }}
                      >
                        {expandedPayloads.has(index) ? '▼' : '▶'} Raw Operator Result from CINTEL (no transformations)
                      </button>
                      {expandedPayloads.has(index) && (
                        <>
                          <div style={{
                            fontSize: '9px',
                            color: '#6b7280',
                            marginTop: '4px',
                            marginBottom: '4px',
                            fontStyle: 'italic'
                          }}>
                            Note: This is the individual operator result from the operatorResults[] array.
                            conversationId is at the webhook envelope level, not in each operator result.
                          </div>
                          <pre style={{
                            fontSize: '10px',
                            color: '#1f2937',
                            whiteSpace: 'pre-wrap',
                            wordWrap: 'break-word',
                            margin: '8px 0 0 0',
                            fontFamily: 'monospace',
                            backgroundColor: '#f3f4f6',
                            padding: '8px',
                            borderRadius: '4px',
                            maxHeight: '300px',
                            overflowY: 'auto'
                          }}>
                            {JSON.stringify(result.rawPayload, null, 2)}
                          </pre>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  )
}
