import test from 'node:test';
import assert from 'node:assert/strict';

test('actual creator worker handler drops superseded and cancelled generations', { concurrency: false }, async () => {
  const previous = {
    self: globalThis.self,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
    FileReader: globalThis.FileReader,
  };
  const messages = [];
  class MockContext {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }

    fillRect() {}

    drawImage() {}

    getImageData() {
      const data = new Uint8ClampedArray(this.width * this.height * 4);
      for (let index = 0; index < this.width * this.height; index += 1) {
        const value = index % this.width < this.width / 2 ? 40 : 210;
        data[index * 4] = value;
        data[(index * 4) + 1] = value;
        data[(index * 4) + 2] = value;
        data[(index * 4) + 3] = 255;
      }
      return { data };
    }

    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; }

    putImageData() {}
  }
  globalThis.self = { postMessage: (message) => messages.push(message) };
  globalThis.OffscreenCanvas = class MockCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = new MockContext(width, height);
    }

    getContext() { return this.context; }

    toDataURL() { return 'data:image/png;base64,AA=='; }
  };
  globalThis.createImageBitmap = async () => ({ width: 16, height: 16, close() {} });
  globalThis.FileReader = class MockFileReader {
    readAsDataURL() {
      this.result = 'data:image/png;base64,AA==';
      this.onload?.();
    }
  };

  try {
    await import('../src/workers/creatorPipeline.worker.js?worker-generation-test');
    const options = { width: 16, height: 16, colors: 2, stylePreset: 'paintable', yieldEvery: 1 };
    const first = globalThis.self.onmessage({ data: { id: 1, generation: 1, file: new Blob(['first']), options } });
    const second = globalThis.self.onmessage({ data: { id: 2, generation: 2, file: new Blob(['second']), options } });
    await Promise.all([first, second]);
    assert.equal(messages.some((message) => message.id === 1 && message.type === 'result'), false);
    assert.equal(messages.some((message) => message.id === 2 && message.type === 'result'), true);

    const third = globalThis.self.onmessage({ data: { id: 3, generation: 3, file: new Blob(['third']), options } });
    await globalThis.self.onmessage({ data: { type: 'cancel', generation: 4 } });
    await third;
    assert.equal(messages.some((message) => message.id === 3 && message.type === 'result'), false);
  } finally {
    globalThis.self = previous.self;
    globalThis.OffscreenCanvas = previous.OffscreenCanvas;
    globalThis.createImageBitmap = previous.createImageBitmap;
    globalThis.FileReader = previous.FileReader;
  }
});
