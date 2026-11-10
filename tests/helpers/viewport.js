import { act } from 'react';

/** Resize the (fake) window like a user would: sets the width and fires `resize`. Phone = 390, desktop = 1280. */
export const setViewport = (width, height = 800) =>
  act(async () => {
    window.innerWidth = width;
    window.innerHeight = height;
    window.dispatchEvent(new Event('resize'));
  });
export const PHONE = 390;
export const DESKTOP = 1280;
