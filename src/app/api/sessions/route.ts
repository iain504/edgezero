import { db } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const sessions = await db.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 24,
    include: { _count: { select: { messages: true } } },
  });
  return Response.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      tier: s.tier,
      messages: s._count.messages,
      updatedAt: s.updatedAt,
    })),
  });
}
