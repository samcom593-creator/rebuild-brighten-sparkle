import React, { useState, useEffect, useCallback, createContext, useContext, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

interface Profile {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  instagram_handle: string | null;
}

interface UserRole {
  role: "admin" | "manager" | "agent";
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: UserRole[];
  isLoading: boolean;
  isAdmin: boolean;
  isManager: boolean;
  isAgent: boolean;
  hasRole: (role: "admin" | "manager" | "agent") => boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<any>;
  signIn: (email: string, password: string) => Promise<any>;
  signOut: () => Promise<{ error: any }>;
  refreshProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string, authEmail?: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    
    if (data && authEmail && data.email !== authEmail) {
      console.log("Syncing profile email with auth email:", authEmail);
      await supabase
        .from("profiles")
        .update({ email: authEmail })
        .eq("user_id", userId);
      
      const { data: updatedData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      
      setProfile(updatedData);
    } else {
      setProfile(data);
    }
  }, []);

  const fetchRoles = useCallback(async (userId: string) => {
    setRolesLoading(true);
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    
    setRoles(data || []);
    setRolesLoading(false);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return;
        
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          setTimeout(async () => {
            if (!isMounted) return;
            await Promise.all([
              fetchProfile(session.user.id, session.user.email),
              fetchRoles(session.user.id)
            ]);
            if (isMounted) setIsLoading(false);
          }, 0);
        } else {
          setProfile(null);
          setRoles([]);
          setRolesLoading(false);
          setIsLoading(false);
        }
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        await Promise.all([
          fetchProfile(session.user.id, session.user.email),
          fetchRoles(session.user.id)
        ]);
      } else {
        setRolesLoading(false);
      }
      if (isMounted) setIsLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, fetchRoles]);

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
        },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const hasRole = (role: "admin" | "manager" | "agent") => {
    return roles.some((r) => r.role === role);
  };

  const isAdmin = hasRole("admin");
  const isManager = hasRole("manager");
  const isAgent = hasRole("agent");
  const isFullyLoaded = !isLoading && !rolesLoading;

  const value: AuthContextValue = {
    user,
    session,
    profile,
    roles,
    isLoading: !isFullyLoaded,
    isAdmin,
    isManager,
    isAgent,
    hasRole,
    signUp,
    signIn,
    signOut,
    refreshProfile: () => user && fetchProfile(user.id),
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
