import { useState, useRef, useEffect } from "react";
import Editor from "@monaco-editor/react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { MonacoBinding } from "y-monaco";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5050";

const LANGUAGE_OPTIONS = [
  { value: "cpp", label: "C++", monaco: "cpp" },
  { value: "c", label: "C", monaco: "c" },
  { value: "java", label: "Java", monaco: "java" },
  { value: "python", label: "Python", monaco: "python" },
  { value: "javascript", label: "JavaScript", monaco: "javascript" },
  { value: "html", label: "HTML", monaco: "html" },
  { value: "css", label: "CSS", monaco: "css" },
  { value: "markdown", label: "Markdown", monaco: "markdown" },
];

const LANGUAGE_SNIPPETS = {
  cpp: `#include <iostream>
using namespace std;

int main() {
  cout << "Hello from C++" << endl;
  return 0;
}
`,
  c: `#include <stdio.h>

int main() {
  printf("Hello from C\\n");
  return 0;
}
`,
  java: `public class Main {
  public static void main(String[] args) {
    System.out.println("Hello from Java");
  }
}
`,
  python: `print("Hello from Python")
`,
  javascript: `console.log("Hello from JavaScript");
`,
  html: `<!doctype html>
<html>
  <head>
    <title>Preview</title>
  </head>
  <body>
    <h1>Hello from HTML</h1>
    <p>This is live preview output.</p>
  </body>
</html>
`,
  css: `body {
  font-family: Arial, sans-serif;
  background: #f5f5f5;
  color: #222;
}

.preview-root {
  max-width: 520px;
  margin: 32px auto;
  padding: 20px;
  border: 1px solid #ccc;
  border-radius: 10px;
  background: #fff;
}

button {
  padding: 8px 12px;
  border: 0;
  border-radius: 6px;
  background: #007acc;
  color: #fff;
}
`,
  markdown: `# Collaborative Notes

- Use this room to discuss code ideas.
- Markdown now renders as preview.
`,
};

function App() {
  const [activeRoom, setActiveRoom] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [userName, setUserName] = useState("");
  const [activeUsers, setActiveUsers] = useState([]);
  const [output, setOutput] = useState("");
  const [outputType, setOutputType] = useState("text");
  const [previewHtml, setPreviewHtml] = useState("");
  const [language, setLanguage] = useState("cpp");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [editorReady, setEditorReady] = useState(false);

  const [userColor] = useState(() => {
    // Distinct, accessible colors
    const colors = ["#ff3333", "#00d084", "#0693e3", "#9b51e0", "#fcb900"];
    return colors[Math.floor(Math.random() * colors.length)];
  });

  const docRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const languageRef = useRef(language);
  const providerRef = useRef(null);
  const bindingRef = useRef(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    if (!activeRoom || !editorReady || !editorRef.current) return;

    providerRef.current?.destroy();
    bindingRef.current?.destroy();
    docRef.current?.destroy();
    docRef.current = new Y.Doc();

    // 1. Initialize WebRTC Provider
    const roomName = `conflux-${activeRoom}`; // Re-added the prefix to prevent public room collisions
    providerRef.current = new WebrtcProvider(roomName, docRef.current, {
      signaling: ["wss://signaling.yjs.dev"], // Re-added signaling servers for stability
    });
    
    const awareness = providerRef.current.awareness;

    // Set local awareness state
    awareness.setLocalStateField("user", {
      name: userName || "Anonymous",
      color: userColor,
    });

    // Listen to changes to populate active users for the navbar
    const updateUsers = () => {
      const states = Array.from(awareness.getStates().entries());
      const users = states.map(([clientId, state]) => {
        if (state.user) {
          return { clientId, ...state.user };
        }
        return null;
      }).filter(Boolean);
      setActiveUsers(users);
    };

    awareness.on("change", updateUsers);
    
    // 2. Bind Monaco to Yjs Shared Text
    const type = docRef.current.getText("monaco");
    if (!type.length) {
      type.insert(0, LANGUAGE_SNIPPETS[languageRef.current]);
    }
    bindingRef.current = new MonacoBinding(
      type,
      editorRef.current.getModel(),
      new Set([editorRef.current]),
      awareness
    );

    // 3. Sync room chat with Yjs shared array
    const chatType = docRef.current.getArray("chat");
    const syncChatMessages = () => {
      setChatMessages(chatType.toArray());
    };
    syncChatMessages();
    chatType.observe(syncChatMessages);

    return () => {
      awareness.off("change", updateUsers);
      chatType.unobserve(syncChatMessages);
      providerRef.current?.destroy();
      bindingRef.current?.destroy();
      docRef.current?.destroy();
      setChatMessages([]);
      setActiveUsers([]);
    };
  }, [activeRoom, editorReady, userName, userColor]); // Runs when room is joined or editor loads

  useEffect(() => {
    const selected = LANGUAGE_OPTIONS.find((item) => item.value === language);
    const model = editorRef.current?.getModel();
    if (selected && model && monacoRef.current) {
      monacoRef.current.editor.setModelLanguage(model, selected.monaco);
    }
  }, [language]);

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorReady(true);
  };

  const runCode = async () => {
    if (!editorRef.current) return;
    setOutput("Running...");
    setOutputType("text");
    setPreviewHtml("");

    try {
      const res = await fetch(`${API_BASE_URL}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: editorRef.current.getValue(), language }),
      });

      const data = await res.json();
      setOutput(data.output || "Program executed.");
      setOutputType(data.outputType || "text");
      setPreviewHtml(data.previewHtml || "");
    } catch (err) {
      console.error(err);
      setOutput(`Error: ${err.message || 'Backend is offline. Check terminal.'}`);
      setOutputType("text");
      setPreviewHtml("");
    }
  };

  const sendChatMessage = () => {
    const text = chatInput.trim();
    if (!text || !activeRoom || !docRef.current) return;

    const chatType = docRef.current.getArray("chat");
    chatType.push([
      {
        id: `${docRef.current.clientID}-${Date.now()}`,
        name: userName || "Anonymous",
        color: userColor,
        text,
        timestamp: Date.now(),
        clientId: docRef.current.clientID,
      },
    ]);
    setChatInput("");
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#1e1e1e", color: "white" }}>
      {/* Dynamic CSS for Monaco Cursors */}
      <style>
        {activeUsers.map(u => `
          .yRemoteSelection-${u.clientId} {
            background-color: transparent !important; /* Disabled selection highlighting as requested */
          }
          .yRemoteSelectionHead-${u.clientId} {
            position: absolute;
            border-left: 2px solid ${u.color};
            box-sizing: border-box;
            display: inline-block;
            height: 100%;
          }
          .yRemoteSelectionHead-${u.clientId}::after {
            position: absolute;
            content: '${u.name}';
            border: 1px solid ${u.color};
            border-bottom: 0px;
            left: -2px;
            top: -16px;
            font-size: 11px;
            font-family: 'Inter', sans-serif;
            background-color: ${u.color};
            color: #fff;
            font-weight: 600;
            padding: 0px 4px;
            border-radius: 4px;
            border-bottom-left-radius: 0;
            white-space: nowrap;
            pointer-events: none;
            z-index: 10;
          }
        `).join('\n')}
      </style>

      {/* Navbar */}
      <div style={{ padding: "10px 20px", background: "#1e1e1e", borderBottom: "1px solid #333", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 2px 10px rgba(0,0,0,0.2)", zIndex: 10 }}>
        {!activeRoom ? (
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <h2 style={{ margin: "0 20px 0 0", fontSize: "1.2rem", fontWeight: "600", color: "#e0e0e0" }}>Conflux</h2>
            <input 
              value={userName} 
              onChange={(e) => setUserName(e.target.value)} 
              placeholder="Your Name" 
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #444", background: "#252526", color: "white", outline: "none", fontSize: "14px", transition: "border 0.2s" }} 
              onFocus={(e) => e.target.style.borderColor = "#007acc"}
              onBlur={(e) => e.target.style.borderColor = "#444"}
            />
            <input 
              value={roomId} 
              onChange={(e) => setRoomId(e.target.value)} 
              placeholder="Enter Room ID" 
              style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #444", background: "#252526", color: "white", outline: "none", fontSize: "14px", transition: "border 0.2s" }} 
              onFocus={(e) => e.target.style.borderColor = "#007acc"}
              onBlur={(e) => e.target.style.borderColor = "#444"}
            />
            <button 
              onClick={() => { 
                if(roomId && userName) setActiveRoom(roomId); 
                else alert("Please enter both your Name and a Room ID to join."); 
              }} 
              style={{ padding: "8px 16px", cursor: "pointer", background: "#007acc", color: "white", border: "none", borderRadius: "6px", fontWeight: "500", transition: "background 0.2s" }}
              onMouseOver={(e) => e.target.style.background = "#005f9e"}
              onMouseOut={(e) => e.target.style.background = "#007acc"}
            >
              Join Room
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", width: "100%", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#252526", padding: "6px 12px", borderRadius: "6px", border: "1px solid #333" }}>
                <span style={{ fontSize: "12px", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Room</span>
                <span style={{ fontWeight: "600", color: "#e0e0e0" }}>{activeRoom}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#252526", padding: "6px 12px", borderRadius: "6px", border: "1px solid #333" }}>
                <span style={{ fontSize: "12px", color: "#888", textTransform: "uppercase", letterSpacing: "1px" }}>Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  style={{
                    background: "#1e1e1e",
                    color: "#fff",
                    border: "1px solid #444",
                    borderRadius: "6px",
                    padding: "6px 10px",
                    outline: "none",
                    cursor: "pointer",
                  }}
                >
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "#252526", padding: "4px 12px", borderRadius: "20px", border: "1px solid #333" }}>
                <span style={{ fontSize: "12px", color: "#888", marginRight: "4px" }}>Active Users:</span>
                <div style={{ display: "flex" }}>
                  {activeUsers.map((u, i) => (
                    <div 
                      key={u.clientId} 
                      title={u.name} 
                      style={{ 
                        width: "30px", height: "30px", borderRadius: "50%", background: u.color, 
                        display: "flex", alignItems: "center", justifyContent: "center", 
                        fontWeight: "bold", border: "2px solid #1e1e1e", fontSize: "14px",
                        marginLeft: i > 0 ? "-10px" : "0", zIndex: activeUsers.length - i,
                        boxShadow: "0 2px 4px rgba(0,0,0,0.2)", cursor: "default"
                      }}
                    >
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <button 
              onClick={runCode} 
              style={{ 
                background: "#4caf50", color: "white", border: "none", padding: "8px 24px", 
                cursor: "pointer", borderRadius: "6px", fontWeight: "600", fontSize: "14px",
                display: "flex", alignItems: "center", gap: "8px", transition: "background 0.2s"
              }}
              onMouseOver={(e) => e.target.style.background = "#388e3c"}
              onMouseOut={(e) => e.target.style.background = "#4caf50"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Run Code
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, borderRight: "1px solid #333" }}>
          {activeRoom && (
             <Editor
              height="100%"
              theme="vs-dark"
              language={LANGUAGE_OPTIONS.find((item) => item.value === language)?.monaco || "cpp"}
              onMount={handleEditorDidMount}
              options={{ fontSize: 16, minimap: { enabled: false }, automaticLayout: true }}
            />
          )}
        </div>
        <div style={{ width: "350px", background: "#111", borderLeft: "1px solid #333", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "15px", borderBottom: "1px solid #222", maxHeight: "45%", overflowY: "auto" }}>
            <div style={{ color: "#888", fontSize: "12px", marginBottom: "10px", letterSpacing: "1px" }}>OUTPUT</div>
            {outputType === "preview" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ color: "#9cdcfe", fontSize: "12px" }}>{output}</div>
                <iframe
                  title="code-preview"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts"
                  style={{
                    width: "100%",
                    minHeight: "180px",
                    border: "1px solid #333",
                    borderRadius: "8px",
                    background: "#fff",
                  }}
                />
              </div>
            ) : (
              <pre style={{ color: "#d4d4d4", whiteSpace: "pre-wrap", fontFamily: "Consolas, monospace", fontSize: "14px", margin: 0 }}>
                {output || "No output yet..."}
              </pre>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{ padding: "12px 15px", borderBottom: "1px solid #222", color: "#888", fontSize: "12px", letterSpacing: "1px" }}>
              ROOM CHAT
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "12px 15px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {chatMessages.length === 0 ? (
                <div style={{ color: "#666", fontSize: "13px" }}>No messages yet. Start the conversation.</div>
              ) : (
                chatMessages.map((msg) => (
                  <div key={msg.id} style={{ background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "8px 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", alignItems: "center" }}>
                      <span style={{ color: msg.color || "#4f9cf9", fontWeight: 600, fontSize: "13px" }}>{msg.name}</span>
                      <span style={{ color: "#777", fontSize: "11px" }}>
                        {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                    </div>
                    <div style={{ color: "#d4d4d4", fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{msg.text}</div>
                  </div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>

            <div style={{ padding: "12px", borderTop: "1px solid #222", display: "flex", gap: "8px" }}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendChatMessage();
                }}
                placeholder="Type a message..."
                style={{ flex: 1, padding: "8px 10px", borderRadius: "6px", border: "1px solid #333", background: "#1e1e1e", color: "#fff", outline: "none" }}
              />
              <button
                onClick={sendChatMessage}
                style={{ padding: "8px 12px", borderRadius: "6px", border: "none", background: "#007acc", color: "#fff", cursor: "pointer", fontWeight: 600 }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

