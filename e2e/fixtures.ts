import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      // Silence the device output while preserving real decoding and mixing.
      const connect = AudioNode.prototype.connect;
      const outputs = new WeakMap<AudioDestinationNode, GainNode>();
      AudioNode.prototype.connect = function (
        this: AudioNode,
        ...args: [AudioNode | AudioParam, number?, number?]
      ) {
        const destination = args[0];
        if (
          destination instanceof AudioDestinationNode &&
          destination.context instanceof AudioContext
        ) {
          let output = outputs.get(destination);
          if (!output) {
            output = destination.context.createGain();
            output.gain.value = 0;
            Reflect.apply(connect, output, [destination]);
            outputs.set(destination, output);
          }
          args[0] = output;
        }
        const result = Reflect.apply(connect, this, args);
        return destination instanceof AudioNode ? destination : result;
      } as typeof connect;
      const disconnect = AudioNode.prototype.disconnect;
      AudioNode.prototype.disconnect = function (
        this: AudioNode,
        ...args: unknown[]
      ) {
        if (args[0] instanceof AudioDestinationNode)
          args[0] = outputs.get(args[0]) ?? args[0];
        Reflect.apply(disconnect, this, args);
      };

      // The asset audition page uses media elements instead of Web Audio.
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        this.muted = true;
        return play.call(this);
      };
    });
    await use(context);
  },
});
