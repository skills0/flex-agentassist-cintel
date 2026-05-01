'use client';

import { useEffect, useState } from 'react';
import scriptDimensionsData from '../config/scriptDimensions.json';

// For runtime config, use 'key: string'.
// For stricter type safety, consider generating a union type from JSON keys at build time.
type ScriptDimension = {
  key: string;
  label: string;
  description: string;
  completed: boolean;
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
  result: any;
};

interface ScriptAdherenceProps {
  operatorResults: OperatorResult[];
}

export default function ScriptAdherence({
  operatorResults,
}: ScriptAdherenceProps) {
  const [dimensions, setDimensions] = useState<ScriptDimension[]>([]);

  const [explanation, setExplanation] = useState<string>('');

  // Load dimensions from JSON file on mount
  // Using imported JSON data instead of fetch for better reliability with Flex plugin build
  useEffect(() => {
    console.log(
      '[ScriptAdherence] Loaded dimensions from imported JSON:',
      scriptDimensionsData,
    );
    setDimensions(scriptDimensionsData);
  }, []);

  // Update dimensions based on operator results
  useEffect(() => {
    console.log(
      '[ScriptAdherence] Processing operatorResults:',
      operatorResults,
    );
    if (operatorResults.length === 0) {
      // Reset to initial state when no results
      setDimensions((prev) => {
        const reset = prev.map((dim) => ({ ...dim, completed: false }));
        console.log(
          '[ScriptAdherence] No operatorResults, resetting dimensions:',
          reset,
        );
        return reset;
      });
      setExplanation('');
      return;
    }

    // Get the latest Script Adherence operator result
    const scriptAdherenceResults = operatorResults.filter((result) => {
      const operatorName =
        typeof result.operator === 'string'
          ? result.operator
          : result.operator?.friendlyName || '';
      return (
        operatorName.toLowerCase().includes('script') ||
        operatorName.toLowerCase().includes('adherence')
      );
    });
    console.log(
      '[ScriptAdherence] Filtered script adherence results:',
      scriptAdherenceResults,
    );

    if (scriptAdherenceResults.length === 0) {
      console.log('[ScriptAdherence] No script adherence results found.');
      return;
    }

    // Use the latest result
    const latestResult =
      scriptAdherenceResults[scriptAdherenceResults.length - 1];
    const resultData = latestResult.result;
    console.log(
      '[ScriptAdherence] Latest script adherence resultData:',
      resultData,
    );

    // Update dimensions based on resultData
    setDimensions((prev) => {
      const updated = prev.map((dim) => {
        const category = resultData?.categories?.find(
          (c: { category_key: string }) => c.category_key === dim.key,
        );
        const completed =
          !!category &&
          category.criteria.length > 0 &&
          category.criteria.every(
            (c: { criteria_met: string }) => c.criteria_met === 'Succeeded',
          );
        return { ...dim, completed };
      });
      console.log('[ScriptAdherence] Updated dimensions:', updated);
      return updated;
    });
    setExplanation(resultData?.explanation || '');
    if (resultData?.explanation) {
      console.log('[ScriptAdherence] Explanation:', resultData.explanation);
    }
  }, [operatorResults]);

  const completedCount = dimensions.filter((d) => d.completed).length;
  const totalCount = dimensions.length;
  const progressPercentage = (completedCount / totalCount) * 100;

  return (
    <div
      style={{
        padding: '20px',
        borderRadius: '8px',
        backgroundColor: '#f9fafb',
        border: '1px solid #e5e7eb',
        width: '100%',
        maxWidth: '800px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ marginBottom: '16px' }}>
        <h2
          style={{
            fontSize: '18px',
            fontWeight: '600',
            color: '#1f2937',
            marginBottom: '4px',
          }}
        >
          Script Adherence
        </h2>
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          Tracking agent compliance with required support script
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ marginBottom: '16px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '13px',
          }}
        >
          <span style={{ color: '#6b7280' }}>Progress</span>
          <span style={{ fontWeight: '600', color: '#1f2937' }}>
            {completedCount} / {totalCount}
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: '6px',
            backgroundColor: '#e5e7eb',
            borderRadius: '3px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progressPercentage}%`,
              height: '100%',
              backgroundColor:
                progressPercentage === 100 ? '#10b981' : '#3b82f6',
              transition: 'width 0.5s ease-in-out',
            }}
          />
        </div>
      </div>

      {/* Dimensions */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}
      >
        {dimensions.map((dimension) => (
          <div
            key={dimension.key}
            style={{
              padding: '12px',
              borderRadius: '6px',
              backgroundColor: dimension.completed ? '#d1fae5' : '#f3f4f6',
              border: `2px solid ${dimension.completed ? '#10b981' : '#e5e7eb'}`,
              transition: 'all 0.3s ease-in-out',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '6px',
              }}
            >
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: '600',
                  color: dimension.completed ? '#065f46' : '#1f2937',
                }}
              >
                {dimension.label}
              </div>
              <div
                style={{
                  padding: '3px 10px',
                  borderRadius: '10px',
                  fontSize: '11px',
                  fontWeight: '600',
                  backgroundColor: dimension.completed ? '#10b981' : '#9ca3af',
                  color: 'white',
                }}
              >
                {dimension.completed ? 'Done' : 'Pending'}
              </div>
            </div>
            <div
              style={{
                fontSize: '12px',
                color: dimension.completed ? '#047857' : '#6b7280',
                lineHeight: '1.4',
              }}
            >
              {dimension.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
