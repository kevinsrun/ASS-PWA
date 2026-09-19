import Link from 'next/link';
export default function DeveloperLayout({children}:{children:React.ReactNode}){
 return <><nav aria-label="Developer tools" style={{padding:'16px 24px'}}><Link href="/debug/health">Health</Link> · <Link href="/debug/ai">AI Usage</Link> · <Link href="/debug/models">Local models</Link> · <Link href="/debug/training">Training data</Link></nav>{children}</>;
}
