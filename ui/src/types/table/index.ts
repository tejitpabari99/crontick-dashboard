import { registerCardType } from '../../registry/registry.ts';
import { TableBody } from './TableBody.tsx';
import { tableSearchText } from './logic.ts';

registerCardType('table', { Component: TableBody, searchText: tableSearchText, allowedModes: ['column', 'now', 'fullscreen'] });
