export async function readStream(stream: ReadableStream<Uint8Array> | null, onChunk: (chunk: string) => void) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    onChunk(decoder.decode(value, { stream: true }));
  }
}

export function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

export function readablePipe(pipe: number | ReadableStream<Uint8Array> | undefined) {
  return typeof pipe === "number" || !pipe ? null : pipe;
}
