import { registerCardType } from '../../registry/registry.ts';
import { KpiBody } from './KpiBody.tsx';
import { kpiSearchText } from './logic.ts';

registerCardType('kpi', { Component: KpiBody, searchText: kpiSearchText });
