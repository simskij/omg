import { join, normalize } from "node:path";

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

export async function parseJson<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function createStaticHandler(clientDist: string) {
  return async function serveStatic(pathname: string) {
    const normalizedPath = normalize(pathname === "/" ? "/index.html" : pathname);

    if (normalizedPath.startsWith("..")) {
      return new Response("Not found", { status: 404 });
    }

    const filePath = join(clientDist, normalizedPath);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    const index = Bun.file(join(clientDist, "index.html"));

    if (await index.exists()) {
      return new Response(index);
    }

    return new Response("Client build not found. Run `bun run build` first.", { status: 404 });
  };
}
