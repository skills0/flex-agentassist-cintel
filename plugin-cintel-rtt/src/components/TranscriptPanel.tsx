import React, { useRef } from "react";

export interface TranscriptEntry {
  speaker: "agent" | "customer";
  text: string;
  timestamp: string | number | Date;
}

interface TranscriptPanelProps {
  transcript: TranscriptEntry[];
}

const TranscriptPanel: React.FC<TranscriptPanelProps> = ({ transcript }) => {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      style={{
        background: "white",
        borderRadius: "8px",
        padding: "16px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <h2
        style={{
          fontSize: "14px",
          fontWeight: "600",
          marginBottom: "12px",
          color: "#1f2937",
        }}
      >
        Live Transcript
      </h2>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
          backgroundColor: "#f9fafb",
          borderRadius: "6px",
          border: "1px solid #e5e7eb",
          minHeight: 0,
        }}
      >
        {transcript.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              color: "#9ca3af",
              padding: "40px 20px",
            }}
          >
            Transcript will appear here when the call starts...
          </div>
        ) : (
          <>
            {transcript.map((entry, index) => (
              <div
                key={index}
                style={{
                  marginBottom: "10px",
                  padding: "8px",
                  borderRadius: "6px",
                  backgroundColor:
                    entry.speaker === "agent" ? "#dbeafe" : "#f3e8ff",
                  borderLeft: `3px solid ${entry.speaker === "agent" ? "#3b82f6" : "#a855f7"}`,
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    color: entry.speaker === "agent" ? "#1e40af" : "#7e22ce",
                    marginBottom: "3px",
                  }}
                >
                  {entry.speaker === "agent" ? "Agent" : "Customer"}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#1f2937",
                    lineHeight: "1.4",
                  }}
                >
                  {entry.text}
                </div>
                <div
                  style={{
                    fontSize: "9px",
                    color: "#6b7280",
                    marginTop: "3px",
                  }}
                >
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </>
        )}
      </div>
    </div>
  );
};

export default TranscriptPanel;
