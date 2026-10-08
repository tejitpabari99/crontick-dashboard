import { registerCardType } from '../../registry/registry.ts';
import { MediaBody } from './MediaBody.tsx';
import { mediaSearchText } from './logic.ts';

registerCardType('media', { Component: MediaBody, searchText: mediaSearchText, allowedModes: ['column', 'now', 'fullscreen'] });
