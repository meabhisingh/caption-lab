import { Prisma, prisma } from "@caption-generator/db";
import type {
  CaptionProjectRecord,
  CreateProjectInput,
  ProjectPatch,
  ProjectStore,
} from "./project-store";

const fromPrisma = (project: {
  id: string;
  fileName: string;
  contentType: string;
  mediaType: "AUDIO" | "VIDEO";
  status: CaptionProjectRecord["status"];
  sourceKey: string;
  audioKey: string | null;
  transcriptKey: string | null;
  transcript: unknown;
  captionStyle: unknown;
  durationSeconds: number | null;
  width: number;
  height: number;
  fps: number;
  renderProgress: number;
  exportKey: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CaptionProjectRecord => ({ ...project });

const jsonValue = (value: unknown) => {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

export const createPrismaProjectStore = (): ProjectStore => ({
  create: async (input: CreateProjectInput) =>
    fromPrisma(
      await prisma.captionProject.create({
        data: {
          id: input.id,
          fileName: input.fileName,
          contentType: input.contentType,
          mediaType: input.mediaType,
          sourceKey: input.sourceKey,
          captionStyle: input.captionStyle,
        },
      }),
    ),
  findById: async (id) => {
    const project = await prisma.captionProject.findUnique({ where: { id } });
    return project ? fromPrisma(project) : null;
  },
  requireById: async (id) =>
    fromPrisma(
      await prisma.captionProject.findUniqueOrThrow({ where: { id } }),
    ),
  update: async (id, patch: ProjectPatch) => {
    const data: Prisma.CaptionProjectUpdateInput = {};
    if (patch.status !== undefined) data.status = patch.status;
    if (patch.error !== undefined) data.error = patch.error;
    if (patch.audioKey !== undefined) data.audioKey = patch.audioKey;
    if (patch.transcriptKey !== undefined)
      data.transcriptKey = patch.transcriptKey;
    if (patch.transcript !== undefined)
      data.transcript = jsonValue(patch.transcript);
    if (patch.durationSeconds !== undefined)
      data.durationSeconds = patch.durationSeconds;
    if (patch.renderProgress !== undefined)
      data.renderProgress = patch.renderProgress;
    if (patch.exportKey !== undefined) data.exportKey = patch.exportKey;
    if (patch.captionStyle !== undefined)
      data.captionStyle = jsonValue(patch.captionStyle);
    return fromPrisma(
      await prisma.captionProject.update({ where: { id }, data }),
    );
  },
  close: async () => {
    await prisma.$disconnect();
  },
});
