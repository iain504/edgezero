import { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await db.chatSession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!session) {
    return Response.json({ error: "session not found" }, { status: 404 });
  }
  return Response.json({
    session: {
      id: session.id,
      title: session.title,
      tier: session.tier,
      updatedAt: session.updatedAt,
    },
    messages: session.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      telemetry: m.telemetry ? JSON.parse(m.telemetry) : null,
      createdAt: m.createdAt,
    })),
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.chatSession.delete({ where: { id } }).catch(() => undefined);
  return Response.json({ ok: true });
}
