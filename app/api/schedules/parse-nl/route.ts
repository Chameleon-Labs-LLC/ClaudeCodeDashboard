import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { text } = await request.json();
  // STUB — Haiku integration deferred. See lib/skill-router.ts for the pattern.
  return NextResponse.json({
    cron: null,
    explanation: `NL→cron parsing not yet implemented (input: "${text ?? ''}")`,
  });
}
