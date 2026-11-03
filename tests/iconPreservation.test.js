// The "Anticipo" icon is COINS (a stack + a single coin) and it is the ONLY icon that changed: every other icon of the workspace set
// renders byte for byte what it rendered before (hashes taken from the committed set), BanknoteIcon (cobros) included.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as icons from '../src/components/workspace/icons.jsx';

const hash = (C) => createHash('sha1').update(renderToStaticMarkup(React.createElement(C, { size: 24 }))).digest('hex').slice(0, 12);

const BASELINE = {
  UsersIcon: '7b24cf80cbc8', CalculatorIcon: '57cf7b0d68f1', BanknoteIcon: '3bd942d503e9', BookOpenIcon: '573ec647af2a', ReceiptIcon: 'a69bef356d07',
  AlertTriangleIcon: 'e726f18b52ce', TractorIcon: '229166a35b86', LockIcon: '89f6176981de', UnlockIcon: 'c0af771c6fd2', BellIcon: '8e9e04d0686a',
  UserIcon: 'ae870a269836', ZapIcon: 'ac1170d001be', WrenchIcon: 'c7cc155d3a04', HammerIcon: '5521a2653a90', FlameIcon: '25b47112b125',
  BrushIcon: '4073aa7bfbe1', LeafIcon: 'a7875e280b67', BrickWallIcon: '0463a4b8c2c6', HardHatIcon: '5f1979cf47fc', PickaxeIcon: '5653edecaced',
  RulerIcon: '3808de75b2f8', PaintRollerIcon: 'adce44d8bcfe', TilesIcon: 'ad85e47d420c', LayersIcon: 'e896a1660ce5', DoorIcon: 'dbfac2f39b6d',
  TruckIcon: '2df4b00fb0f5', LandmarkIcon: 'a5921a43a0df', CameraIcon: '7ed6957cfbe3', FileSignatureIcon: '92332a5ee88c', FileCogIcon: '1a0404c43544',
  TableIcon: '55ff2de19d28', CloudUploadIcon: '7aad40f6cb31', SmartphoneIcon: 'bb62c0acf1e0', GlobeIcon: '25d98127517c',
};

describe('icon preservation', () => {
  it('every other icon of the set is untouched (same markup as before)', () => {
    for (const [name, h] of Object.entries(BASELINE)) expect(hash(icons[name]), name).toBe(h);
  });

  it('the set has exactly the old icons + CoinsIcon (nothing else added or removed)', () => {
    const fns = Object.keys(icons).filter((k) => typeof icons[k] === 'function' && k !== 'Outline').sort();
    expect(fns).toEqual([...Object.keys(BASELINE), 'CoinsIcon'].sort());
  });

  it('CoinsIcon is made of ellipse / circle / path on the shared 24 px outline grid', () => {
    const svg = renderToStaticMarkup(React.createElement(icons.CoinsIcon, { size: 28 }));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('<circle');
    expect(svg).toContain('<path');
    expect(svg).not.toContain('<rect');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.5"');
    expect(svg).toContain('data-icon="coins"');
  });

  it('the advance button is the only user of CoinsIcon; the cobros block keeps its BanknoteIcon', () => {
    const crew = readFileSync('src/components/workspace/CrewBlock.jsx', 'utf8');
    expect(crew).toContain('<CoinsIcon size={20} />');
    expect(crew).not.toMatch(/Banknote|CashIcon/);
    const cash = readFileSync('src/components/workspace/CashBlock.jsx', 'utf8');
    expect(cash).toContain('<BanknoteIcon size={32} />');
    expect(cash).not.toContain('CoinsIcon');
  });
});
