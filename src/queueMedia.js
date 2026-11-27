import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const QUEUE_IMAGE_NAMES = Object.freeze([
  'ranked-mascot.png',
  'queue-emote-01.png',
  'queue-emote-02.png',
  'queue-emote-03.gif',
  'queue-emote-04.png',
  'queue-emote-05.png',
  'queue-emote-06.png',
]);
export const QUEUE_DEFAULT_IMAGE = QUEUE_IMAGE_NAMES[0];

/** Sorteia por mensagem; exclui somente a imagem imediatamente anterior no processo. */
export function createQueueImagePicker(random = randomInt) {
  let previous = -1;
  return () => {
    const sample = random(QUEUE_IMAGE_NAMES.length - (previous >= 0 ? 1 : 0));
    const index = previous >= 0 && sample >= previous ? sample + 1 : sample;
    previous = index;
    const name = QUEUE_IMAGE_NAMES[index];
    return { name, path: fileURLToPath(new URL(`../assets/queue/${name}`, import.meta.url)) };
  };
}

export const pickQueueImage = createQueueImagePicker();
