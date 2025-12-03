import fs from "fs";
import { ChatOllama } from "@langchain/ollama";
import { OLLAMA_BASE, MODEL } from "./config.js";
import readline from "readline";
import removeMd from "remove-markdown";
import Speaker from "speaker";
import { Readable } from "stream";
import fetch from "node-fetch"; // make sure node-fetch is installed

const llm = new ChatOllama({
  baseUrl: OLLAMA_BASE,
  model: MODEL,
});

// Convert text chunk to audio buffer via Piper
async function getPiperAudio(text) {
  try {
    const response = await fetch("http://localhost:5000/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("Error fetching Piper audio:", err);
    return null;
  }
}

function playBuffer(buffer, format = { channels: 1, bitDepth: 16, sampleRate: 22050 }) {
  if (!buffer || buffer.length === 0) return;

  const reader = new Readable({
    read() {
      this.push(buffer);
      this.push(null); // end of stream
    },
  });

  const speaker = new Speaker(format);

  reader.pipe(speaker);

  speaker.on("error", (err) => {
    console.error("Error playing audio:", err);
  });
}

// Get Ollama response and stream it to Piper in real-time
async function getOllamaResponse(prompt) {
  try {
    const stream = await llm.stream(prompt);
    let buffer = "";

    for await (const chunk of stream) {
      if (!chunk.content) continue; // skip empty tokens
      buffer += chunk.content;

      // Check for sentence boundaries or max length
      if (/[.!?]$/.test(buffer) || buffer.length > 80) {
        const textToSpeak = removeMd(buffer).trim();
        if (textToSpeak.length > 0) {
          const audio = await getPiperAudio(textToSpeak);
          playBuffer(audio);
        }
        buffer = "";
      }
    }

    // Handle leftover
    const leftover = buffer.trim();
    if (leftover.length > 0) {
      const audio = await getPiperAudio(leftover);
      playBuffer(audio);
    }

    return "Streamed response completed"; // optional
  } catch (err) {
    console.error("Error streaming Ollama:", err);
    return "";
  }
}

// CLI interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptUser() {
  rl.question("Enter prompt (or 'exit' to quit): ", async (input) => {
    if (input.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    await getOllamaResponse(input);

    promptUser();
  });
}

console.log("Chat with Ollama + Piper streaming ready!");
promptUser();
