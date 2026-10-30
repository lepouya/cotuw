import { expect, test } from "vitest";

import {
  worldInputAvailable,
  worldKeyboardAvailable,
} from "../src/render/input-focus";

test.each([
  { focused: true, hidden: false, modal: false, keyboard: true, pointer: true },
  {
    focused: false,
    hidden: false,
    modal: false,
    keyboard: true,
    pointer: false,
  },
  {
    focused: true,
    hidden: true,
    modal: false,
    keyboard: false,
    pointer: false,
  },
  {
    focused: true,
    hidden: false,
    modal: true,
    keyboard: false,
    pointer: false,
  },
  {
    focused: false,
    hidden: false,
    modal: true,
    keyboard: false,
    pointer: false,
  },
])(
  "world input eligibility: %j",
  ({ focused, hidden, modal, keyboard, pointer }) => {
    const document = {
      hidden,
      hasFocus: () => focused,
      querySelector: () => (modal ? {} : null),
    } as unknown as Document;
    expect(worldKeyboardAvailable(document)).toBe(keyboard);
    expect(worldInputAvailable(document)).toBe(pointer);
  },
);
