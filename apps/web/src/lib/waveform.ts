export type Waveform =
  | { status: "idle" | "loading" | "unavailable" }
  | { status: "ready"; peaks: number[] };

/** Number of loudness samples kept for a clip, whatever its length. */
export const WAVEFORM_BUCKETS = 2400;

/**
 * Downloads the speech audio of a project and reduces it to one loudness
 * value per bucket, each from 0 to 1. Rejects when the audio cannot be
 * fetched or decoded, for example when a storage bucket blocks cross-origin
 * requests.
 */
export const loadWaveformPeaks = async (
  url: string,
  signal: AbortSignal,
): Promise<number[]> => {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw new Error(`Audio request failed (${response.status})`);
  const encoded = await response.arrayBuffer();
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(encoded);
    const samples = audio.getChannelData(0);
    const bucketSize = Math.max(
      1,
      Math.floor(samples.length / WAVEFORM_BUCKETS),
    );
    const peaks: number[] = [];
    let loudest = 0;
    for (let start = 0; start < samples.length; start += bucketSize) {
      let peak = 0;
      const end = Math.min(samples.length, start + bucketSize);
      for (let index = start; index < end; index += 1) {
        const value = Math.abs(samples[index] ?? 0);
        if (value > peak) peak = value;
      }
      peaks.push(peak);
      if (peak > loudest) loudest = peak;
    }
    return loudest > 0 ? peaks.map((peak) => peak / loudest) : peaks;
  } finally {
    void context.close();
  }
};
