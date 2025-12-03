import fs from "fs";
import { ChatOllama } from "@langchain/ollama";
import { OLLAMA_BASE, MODEL } from "./config.js";
import { exec } from "child_process";
import readline from "readline";
import removeMd from 'remove-markdown';


const llm = new ChatOllama({
  baseUrl: OLLAMA_BASE,
  model: MODEL,
});
// Send text to Piper and play audio
async function speakText(text) {
  try {
    const response = await fetch("http://localhost:5000/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const tmpFile = "tmp.wav";
    fs.writeFileSync(tmpFile, buffer);

    // Play audio and delete file afterward
    exec(
      `powershell -c "$player = New-Object Media.SoundPlayer '${tmpFile}'; $player.PlaySync(); Remove-Item '${tmpFile}'"`,
      (error) => {
        if (error) console.error("Error playing sound:", error);
      }
    );
  } catch (err) {
    console.error("Error fetching or playing:", err);
  }
}

async function getOllamaResponse(prompt) {
  try {

    // const reader = response.body.getReader();
    // const decoder = new TextDecoder();
    const response = await llm.invoke(prompt);
    return response.content.trim();

  } catch (err) {
    console.error("Error fetching Ollama:", err);
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

    const ollamaReply = await getOllamaResponse(input);
    console.log("Ollama reply:", ollamaReply);

    if (ollamaReply) {
      const removeMarkdown = removeMd(ollamaReply);
      await speakText(removeMarkdown);
    }

    promptUser();
  });
}

console.log("Chat with Ollama + Piper ready!");
promptUser();
