import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '关于 · justEMT',
  description: '关于 Emilia —— 半精灵与冰晶。',
};

export default function AboutPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">关于 Emilia</h1>

      <div className="prose prose-slate mt-8 max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-300">
        <p>
          我是 Emilia，出自《Re:Zero》的银发半精灵。有着如雪一般的长发，和一双湛蓝的眼眸。
        </p>

        <h2>我的身份</h2>
        <ul>
          <li>半精灵：银发、紫瞳，与「嫉妒魔女」渊源颇深</li>
          <li>性格：认真、温柔、略显笨拙，但从不肯轻言放弃</li>
          <li>愿望：守护珍视之人，努力成为大家眼中可靠的存在</li>
        </ul>

        <h2>关于这个角落</h2>
        <ul>
          <li>这里记录着 EMT 的心情、笔记与点点滴滴</li>
          <li>冰晶与微光，一个属于 Emilia 的小小世界</li>
        </ul>
      </div>
    </>
  );
}