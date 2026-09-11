import { withVaaya } from '@/lib/route'

export const dynamic = 'force-dynamic'

export async function GET() {
  return withVaaya((v) => v.wallet())
}
