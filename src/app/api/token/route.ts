import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const backendUrl =
      process.env.GEMINI_SERVER_URL ||
      process.env.NEXT_PUBLIC_GEMINI_SERVER_URL ||
      'https://65-2-161-214.sslip.io';

    const normalizedUrl = backendUrl.replace(/\/+$/, '');
    const targetEndpoint = `${normalizedUrl}/api/token`;

    const res = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ detail: msg }, { status: 500 });
  }
}
