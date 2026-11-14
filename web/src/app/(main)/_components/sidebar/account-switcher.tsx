/**
 * account-switcher.tsx: top-bar avatar account menu; shows the current user with change-password and sign-out entries.
 * Main functions/types:
 *   - AccountSwitcher: avatar-triggered dropdown menu component.
 *   - AccountUser: shape of the passed-in user (id/name/email/avatar/role).
 */
"use client";

import { useState } from "react";

import { Check, KeyRound, LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { auth } from "@/lib/auth";
import { cn, getInitials } from "@/lib/utils";

import { ChangePasswordDialog } from "./change-password-dialog";

interface AccountUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatar: string;
  readonly role: string;
}

// AccountSwitcher is the top-bar single-account menu: avatar trigger; expands to show the current user, change password, and sign out.
// (The original design supported multi-account switching, but the only caller always passes a single user; if multi-account returns, restore the list and selection state.)
export function AccountSwitcher({ user }: { readonly user: AccountUser }) {
  const [pwOpen, setPwOpen] = useState(false);

  function handleLogout() {
    auth.clearToken();
    window.location.href = "/login";
  }

  if (!user) {
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar className="size-8 rounded-lg">
            <AvatarImage src={user.avatar || undefined} alt={user.name} />
            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
          <DropdownMenuItem className="bg-accent/50 p-0" aria-current="true">
            <div className="flex w-full items-center gap-2 px-1 py-1.5">
              <Avatar className="size-9 rounded-lg">
                <AvatarImage src={user.avatar || undefined} alt={user.name} />
                <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.name}</span>
                <span className="truncate text-xs capitalize">{user.role}</span>
              </div>
              <span className="mr-1 flex size-5 items-center justify-center rounded-full text-primary opacity-100">
                <Check aria-hidden="true" />
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPwOpen(true)}>
            <KeyRound />
            Change password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive">
            <LogOut />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </>
  );
}
