import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Send, X, Sparkles, RefreshCw, Minimize2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/ui/glass-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ApplicantContext {
  fullName: string;
  hasLicense: boolean;
  yearsExperience: string;
  currentOccupation: string;
  whyJoin: string;
  status: string;
}

interface LeadQualificationChatProps {
  applicantContext?: ApplicantContext;
  className?: string;
}

export function LeadQualificationChat({ applicantContext, className }: LeadQualificationChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('ai-assistant', {
        body: {
          type: 'chat',
          messages: newMessages,
          applicantContext,
        },
      });

      if (error) throw error;

      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
    } catch (error) {
      console.error('Chat error:', error);
      toast({
        title: "Error",
        description: "Failed to get response. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const suggestedPrompts = [
    "How do I qualify this lead effectively?",
    "What questions should I ask to understand their motivation?",
    "How do I handle the 'I need to think about it' objection?",
    "What's the best follow-up strategy for this lead?",
  ];

  return (
    <>
      {/* Chat Toggle Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="fixed bottom-6 right-6 z-50"
          >
            <Button
              onClick={() => setIsOpen(true)}
              size="lg"
              className="rounded-full h-14 w-14 shadow-lg bg-primary hover:bg-primary/90"
            >
              <MessageSquare className="h-6 w-6" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ 
              opacity: 1, 
              y: 0, 
              scale: 1,
              height: isMinimized ? 'auto' : '500px'
            }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={cn(
              "fixed bottom-6 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]",
              className
            )}
          >
            <GlassCard className="flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Lead Qualification AI</h3>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setIsMinimized(!isMinimized)}
                  >
                    {isMinimized ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={() => setIsOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {!isMinimized && (
                <>
                  {/* Context Banner */}
                  {applicantContext && (
                    <div className="px-4 py-2 bg-primary/5 border-b border-border">
                      <p className="text-xs text-muted-foreground">
                        Discussing: <span className="font-medium text-foreground">{applicantContext.fullName}</span>
                        {applicantContext.hasLicense ? ' (Licensed)' : ' (Unlicensed)'}
                      </p>
                    </div>
                  )}

                  {/* Messages */}
                  <ScrollArea className="flex-1 p-4" ref={scrollRef}>
                    {messages.length === 0 ? (
                      <div className="space-y-4">
                        <p className="text-sm text-muted-foreground text-center">
                          Ask me anything about lead qualification, handling objections, or closing strategies.
                        </p>
                        <div className="space-y-2">
                          {suggestedPrompts.map((prompt, i) => (
                            <button
                              key={i}
                              onClick={() => setInput(prompt)}
                              className="w-full p-2 text-left text-sm rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {messages.map((msg, i) => (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn(
                              "flex",
                              msg.role === 'user' ? 'justify-end' : 'justify-start'
                            )}
                          >
                            <div
                              className={cn(
                                "max-w-[85%] p-3 rounded-lg text-sm",
                                msg.role === 'user'
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-muted'
                              )}
                            >
                              {msg.content}
                            </div>
                          </motion.div>
                        ))}
                        {isLoading && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex justify-start"
                          >
                            <div className="bg-muted p-3 rounded-lg">
                              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                            </div>
                          </motion.div>
                        )}
                      </div>
                    )}
                  </ScrollArea>

                  {/* Input */}
                  <div className="p-4 border-t border-border">
                    {messages.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearChat}
                        className="mb-2 text-xs text-muted-foreground"
                      >
                        Clear conversation
                      </Button>
                    )}
                    <div className="flex gap-2">
                      <Input
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder="Ask about lead qualification..."
                        disabled={isLoading}
                        className="flex-1"
                      />
                      <Button
                        onClick={sendMessage}
                        disabled={!input.trim() || isLoading}
                        size="sm"
                        className="px-3"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
