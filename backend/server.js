const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { exec } = require("child_process");
const fs = require("fs-extra"); 
const path = require("path");
const { marked } = require("marked");

const app = express();
app.use(express.json());
app.use(cors());

const PISTON_EXECUTE_URL = "https://emkc.org/api/v2/piston/execute";
const EXECUTION_PROVIDER = (process.env.EXECUTION_PROVIDER || "local").toLowerCase();
const codesDir = path.join(__dirname, "codes");

if (!fs.existsSync(codesDir)) {
    fs.mkdirSync(codesDir, { recursive: true });
}

const languageConfig = {
    cpp: {
        pistonLanguage: "cpp",
        pistonVersion: "*",
        fileName: "main.cpp",
        localCommand: (workspaceDir, filePath) => {
            const outPath = path.join(workspaceDir, "main.exe");
            return `g++ "${filePath}" -o "${outPath}" && "${outPath}"`;
        },
    },
    c: {
        pistonLanguage: "c",
        pistonVersion: "*",
        fileName: "main.c",
        localCommand: (workspaceDir, filePath) => {
            const outPath = path.join(workspaceDir, "main.exe");
            return `gcc "${filePath}" -o "${outPath}" && "${outPath}"`;
        },
    },
    java: {
        pistonLanguage: "java",
        pistonVersion: "*",
        fileName: "Main.java",
        localCommand: (workspaceDir, filePath) =>
            `javac "${filePath}" && java -cp "${workspaceDir}" Main`,
    },
    python: {
        pistonLanguage: "python",
        pistonVersion: "*",
        fileName: "main.py",
        localCommand: (_workspaceDir, filePath) => `python "${filePath}"`,
    },
    javascript: {
        pistonLanguage: "javascript",
        pistonVersion: "*",
        fileName: "main.js",
        localCommand: (_workspaceDir, filePath) => `node "${filePath}"`,
    },
    markdown: { preview: true },
    html: { preview: true },
    css: { preview: true },
};

const executeWithPiston = async (config, code, stdin) => {
    const pistonResponse = await axios.post(
        PISTON_EXECUTE_URL,
        {
            language: config.pistonLanguage,
            version: config.pistonVersion,
            files: [{ content: code }],
            stdin,
        },
        { timeout: 20000 }
    );

    const { run, compile } = pistonResponse.data || {};
    return (
        run?.stdout ||
        run?.stderr ||
        compile?.stdout ||
        compile?.stderr ||
        run?.output ||
        "Program executed with no output."
    );
};

const executeLocally = (config, code) =>
    new Promise((resolve, reject) => {
        const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const workspaceDir = path.join(codesDir, runId);
        fs.mkdirSync(workspaceDir, { recursive: true });

        const filePath = path.join(workspaceDir, config.fileName);
        fs.writeFileSync(filePath, code);

        const command = config.localCommand(workspaceDir, filePath);
        exec(
            command,
            { timeout: 15000, maxBuffer: 1024 * 1024, cwd: workspaceDir, shell: true },
            (error, stdout, stderr) => {
                fs.remove(workspaceDir).catch(() => {});

                if (error) {
                    if (error.killed) {
                        return reject(new Error("Execution timed out after 15 seconds."));
                    }
                    return reject(new Error(stderr || error.message));
                }

                resolve(stdout || stderr || "Program executed with no output.");
            }
        );
    });

app.post('/run', async (req, res) => {
    const { code, language = "cpp", stdin = "" } = req.body;
    
    if (!code) {
        return res.status(400).send({ output: "No code provided" });
    }

    const normalizedLanguage = language.toLowerCase();
    const config = languageConfig[normalizedLanguage];
    if (!config) {
        return res.status(400).send({ output: `Unsupported language: ${language}` });
    }

    if (normalizedLanguage === "markdown") {
        return res.send({
            output: "Markdown rendered successfully.",
            outputType: "preview",
            previewHtml: marked.parse(code),
        });
    }

    if (normalizedLanguage === "html") {
        return res.send({
            output: "HTML rendered successfully.",
            outputType: "preview",
            previewHtml: code,
        });
    }

    if (normalizedLanguage === "css") {
        return res.send({
            output: "CSS rendered successfully with sample markup.",
            outputType: "preview",
            previewHtml: `<style>${code}</style><div class="preview-root"><h2>CSS Preview</h2><p>Edit styles to see changes.</p><button>Sample Button</button></div>`,
        });
    }

    try {
        const output =
            EXECUTION_PROVIDER === "piston"
                ? await executeWithPiston(config, code, stdin)
                : await executeLocally(config, code);

        return res.send({
            output,
            outputType: "text",
        });
    } catch (error) {
        const fallbackMessage =
            error?.response?.data?.message ||
            error?.message ||
            "Execution service is unavailable.";

        return res.status(500).send({
            output: `Execution failed: ${fallbackMessage}`,
            outputType: "text",
        });
    }
});

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => console.log(`✅ Backend running on http://localhost:${PORT}`));
