import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const voice = searchParams.get('voice') || 'USA';

    const backendUrl =
      process.env.GEMINI_SERVER_URL ||
      process.env.NEXT_PUBLIC_GEMINI_SERVER_URL ||
      'https://65-2-161-214.sslip.io';

    const normalizedUrl = backendUrl.replace(/\/+$/, '');
    const targetEndpoint = `${normalizedUrl}/voice-preview?voice=${encodeURIComponent(voice)}`;

    const res = await fetch(targetEndpoint, {
      method: 'GET',
    });

    if (!res.ok) {
      return NextResponse.json(
        { detail: `Failed to fetch preview from backend: ${res.status}` },
        { status: res.status }
      );
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'audio/wav',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ detail: msg }, { status: 500 });
  }
}
