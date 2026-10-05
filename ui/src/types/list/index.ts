import { registerCardType } from '../../registry/registry.ts';
import { ListBody } from './ListBody.tsx';
import { listSearchText } from './logic.ts';

registerCardType('list', { Component: ListBody, searchText: listSearchText });
