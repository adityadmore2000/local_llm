const fs = require("fs");
const { exec } = require("child_process");
const readline = require("readline");
const removeMd = require('remove-markdown');

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
    const response = await fetch("http://localhost:11434/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.1",
        messages: [{ role: "user", content: prompt }],
        stream: true
      }),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let fullText = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);

      // Ollama sends multiple JSON objects concatenated
      const lines = chunk.split("\n").filter(l => l.trim().length > 0);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);

          if (json.message && json.message.content) {
            fullText += json.message.content;
          }

        } catch (err) {
          // Skip broken JSON lines
        }
      }
    }

    return fullText.trim();

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
