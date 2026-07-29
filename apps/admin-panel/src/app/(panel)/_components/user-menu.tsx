"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@hanuja/ui";
import { LogOut, User } from "lucide-react";
import { signOut } from "@/lib/auth-client";

interface UserMenuProps {
  displayName: string;
  initial: string;
}

export function UserMenu({ displayName, initial }: UserMenuProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);

    try {
      await signOut();
    } finally {
      router.push("/giris");
      router.refresh();
      setIsSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-3 rounded-full px-2 py-1">
          <span className="text-sm" style={{ color: "var(--color-muted-fg)" }}>
            {displayName}
          </span>
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => router.push("/profil")}>
          <User className="h-4 w-4" />
          Profil
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSignOut} disabled={isSigningOut}>
          <LogOut className="h-4 w-4" />
          Çıkış Yap
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
