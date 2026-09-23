'use client'

import { useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import { AskQuestionPanel } from '@/components/product-questions/ask-question-panel'

/** "Satıcıya Soru Sor" for one ordered product line; the question is bound to this order and product. */
export function OrderLineQuestion({ orderId, productId }: { orderId: string; productId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
        style={{ color: 'var(--color-accent)' }}
      >
        <MessageCircleQuestion className="h-3.5 w-3.5" />
        Satıcıya Soru Sor
      </button>
      {open ? (
        <div className="mt-2">
          <AskQuestionPanel
            productId={productId}
            orderId={orderId}
            loginReturnPath={`/siparis/${orderId}`}
            autoFocus
            onCancel={() => setOpen(false)}
          />
        </div>
      ) : null}
    </div>
  )
}
