// Daftarkan ts-ext-loader sebelum test berjalan.
// Dipakai via: node --import ./tests/register-loader.mjs --test tests/*.test.mjs
import { register } from 'node:module';

register('./ts-ext-loader.mjs', import.meta.url);
