import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import { env } from "@caption-generator/env/server";

export class AI {
  private readonly client: Groq;

  constructor() {
    this.client = new Groq({ apiKey: env.GROQ_API_KEY });
  }

  transcribe = async ({ audioPath }: { audioPath: string }) => {
    const transcription = await this.client.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-large-v3-turbo",
      temperature: 0,
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });
    return transcription;
  };
}
