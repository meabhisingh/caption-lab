import type {
  CaptionProject,
  CaptionStyle,
  CaptionWord,
} from "@caption-generator/types";

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

async function parseResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    (T & { error?: string }) | null;
  if (!response.ok || !body)
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  return body;
}

// `keepalive` lets a request outlive the page, for saves made while it closes.
const json = (
  method: string,
  body: unknown,
  keepalive = false,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  keepalive,
});

export const fetchProject = async (id: string) =>
  parseResponse<CaptionProject>(
    await fetch(`${SERVER_URL}/api/projects/${id}`),
  );

export const createProject = async (file: File) => {
  const form = new FormData();
  form.set("file", file);
  return parseResponse<CaptionProject>(
    await fetch(`${SERVER_URL}/api/projects`, { method: "POST", body: form }),
  );
};

export const saveProjectStyle = async (
  id: string,
  style: CaptionStyle,
  keepalive = false,
) =>
  parseResponse<CaptionProject>(
    await fetch(
      `${SERVER_URL}/api/projects/${id}/style`,
      json("PATCH", style, keepalive),
    ),
  );

export const saveProjectWords = async (
  id: string,
  words: CaptionWord[],
  keepalive = false,
) =>
  parseResponse<CaptionProject>(
    await fetch(
      `${SERVER_URL}/api/projects/${id}/words`,
      json("PATCH", { words }, keepalive),
    ),
  );

/** Restores the words Groq returned, discarding manual edits. */
export const resetProjectWords = async (id: string) =>
  parseResponse<CaptionProject>(
    await fetch(`${SERVER_URL}/api/projects/${id}/words/reset`, {
      method: "POST",
    }),
  );

export const exportProject = async (id: string) =>
  parseResponse<CaptionProject>(
    await fetch(`${SERVER_URL}/api/projects/${id}/export`, { method: "POST" }),
  );
