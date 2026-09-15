import type { Metadata } from 'next';
import HomePage from '@/components/home-page';
import { quotes } from '@/data/quotes';

export const metadata: Metadata = {
  title: 'justEMT · 爱蜜莉雅主题站',
  description: 'EMT —— 爱蜜莉雅碳真是天使。一座冰上的美术馆，献给银发半精灵。',
};

export default function Page() {
  return <HomePage quotes={quotes} />;
}