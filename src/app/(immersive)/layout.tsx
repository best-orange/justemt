/** 沉浸式页面（首页 / 登录页）：内容全宽，壁纸直接承载内容 */
export default function ImmersiveLayout({ children }: { children: React.ReactNode }) {
  return <main className="site-main site-main--immersive">{children}</main>;
}