// file: streaming-ollama-coqui-ffplay.js
import { ChatOllama } from "@langchain/ollama";
import { OLLAMA_BASE, MODEL } from "./config.js";
import readline from "readline";
import removeMd from "remove-markdown";
import fetch from "node-fetch";
import { spawn } from "child_process";

const llm = new ChatOllama({
  baseUrl: OLLAMA_BASE,
  model: MODEL,
});

// ---------- Playback helper using ffplay (plays from a Buffer) ----------
function playBufferWithFFplay(buffer) {
  return new Promise((resolve, reject) => {
    if (!buffer || buffer.length === 0) return resolve();

    // Use ffplay to play from stdin. -autoexit to exit when done, -nodisp disables display
    // On Windows ffplay.exe should be available in PATH (ffmpeg build)
    const ffplay = spawn("ffplay", ["-autoexit", "-nodisp", "-hide_banner", "-loglevel", "warning", "-"], {
      stdio: ["pipe", "ignore", "inherit"],
    });

    ffplay.on("error", (err) => {
      // e.g., ffplay not found
      reject(err);
    });

    ffplay.on("close", (code, signal) => {
      // code === 0 normally
      resolve();
    });

    // Write buffer to ffplay stdin and close it to start playback
    ffplay.stdin.write(buffer);
    ffplay.stdin.end();
  });
}

// ---------- Call Coqui TTS endpoint and return WAV bytes (Buffer) ----------
async function fetchCoquiWav(text, opts = {}) {
  const {
    baseUrl = "http://localhost:5003",
    speaker_id = "p376",
    // speaker_style = "",
    // language = "",
  } = opts;

  // const url = `${baseUrl}/api/tts?text=${encodeURIComponent(text)}&speaker_id=${encodeURIComponent(speaker_id)}&speaker_style=${encodeURIComponent(speaker_style)}&language=${encodeURIComponent(language)}`;
  const url = `${baseUrl}/api/tts?text=${encodeURIComponent(text)}&speaker_id=${encodeURIComponent(speaker_id)}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TTS error ${res.status}: ${body}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------- Small FIFO play queue so audio chunks play sequentially ----------
const playQueue = [];
let playing = false;

async function enqueueAndPlay(buffer) {
  if (!buffer || buffer.length === 0) return;
  playQueue.push(buffer);
  if (playing) return;
  playing = true;
  while (playQueue.length > 0) {
    const buf = playQueue.shift();
    try {
      await playBufferWithFFplay(buf);
    } catch (err) {
      console.error("ffplay playback error:", err);
      // swallow error and continue
    }
  }
  playing = false;
}

// ---------- Main streaming function (LLM -> chunk -> Coqui -> ffplay) ----------
async function getOllamaResponseStreamToTTS(prompt, ttsOpts = {}) {
  try {
    const stream = await llm.stream(prompt);
    let textBuffer = "";

    for await (const chunk of stream) {
      if (!chunk?.content) continue;
      textBuffer += chunk.content;

      // Decide when to emit/send chunk to TTS:
      // - end punctuation OR
      // - buffer exceeds max length (characters)
      if (/[.!?]["']?\s*$/.test(textBuffer) && textBuffer.length > 120){
        const toSpeak = removeMd(textBuffer).trim();
        if (toSpeak.length > 0) {
          // Fire off fetch + playback (queued) but don't block streaming tokens
          (async () => {
            try {
              const wavBuf = await fetchCoquiWav(toSpeak, ttsOpts);
              await enqueueAndPlay(wavBuf);
            } catch (err) {
              console.error("Error generating/playing TTS chunk:", err);
            }
          })();
        }
        textBuffer = "";
      }
    }

    // leftover
    const leftover = textBuffer.trim();
    if (leftover.length > 0) {
      try {
        const wavBuf = await fetchCoquiWav(leftover, ttsOpts);
        await enqueueAndPlay(wavBuf);
      } catch (err) {
        console.error("Error generating/playing leftover:", err);
      }
    }

    return "streaming completed";
  } catch (err) {
    console.error("Error streaming from Ollama:", err);
    throw err;
  }
}

// ---------- CLI prompt ----------
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptLoop() {
  rl.question("Enter prompt (or 'exit'): ", async (input) => {
    if (input.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    try {
      // ttsOpts: pass speaker/style/lang if needed
      await getOllamaResponseStreamToTTS(input, { baseUrl: "http://localhost:5003", speaker_id: "p376" });
    } catch (err) {
      console.error("Failed streaming:", err);
    }

    promptLoop();
  });
}

console.log("Streaming Ollama -> Coqui -> ffplay ready.");
promptLoop();
