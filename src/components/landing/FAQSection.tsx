import { motion } from "framer-motion";
import { SectionHeading } from "@/components/ui/section-heading";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "Do I need an insurance license to get started?",
    answer: "No! While having a license is a plus, we welcome unlicensed candidates. We'll guide you through the licensing process, cover your study materials, and even reimburse your licensing fees once you're contracted. Most new agents get licensed within 2-3 weeks.",
  },
  {
    question: "How does the lead program work?",
    answer: "Our exclusive lead program provides you with 50-100 warm, pre-qualified leads per week. These are people who have already expressed interest in life insurance—no cold calling required. Leads are distributed based on your production and commitment level.",
  },
  {
    question: "What are the commission rates?",
    answer: "We offer industry-leading commission rates of 140-160% on first-year premiums. Plus, you'll earn renewals for years to come. Top producers also qualify for production bonuses up to $25,000 per month.",
  },
  {
    question: "Is this a full-time or part-time opportunity?",
    answer: "Both! Many of our agents start part-time while keeping their current job. You set your own schedule and work as much or as little as you want. Part-time agents typically earn $5K-10K per month; full-time agents often exceed $20K monthly.",
  },
  {
    question: "What kind of training do you provide?",
    answer: "We provide comprehensive training including: 1-on-1 mentorship with a top producer, weekly sales training calls, proven scripts and objection handling, CRM and technology training, and ongoing coaching. Most new agents close their first sale within their first two weeks.",
  },
  {
    question: "How quickly can I start earning?",
    answer: "Many agents close their first sale within their first week after training. Commissions are paid weekly, so you'll see money in your account fast. We also offer fast-start bonuses up to $10,000 in your first 90 days.",
  },
  {
    question: "What products will I be selling?",
    answer: "We focus primarily on life insurance products including term life, whole life, indexed universal life, and final expense. We're contracted with 30+ top-rated carriers, giving you the flexibility to find the right fit for every client.",
  },
  {
    question: "Is there a cost to join?",
    answer: "There's no upfront cost to join APEX. We invest in you—not the other way around. We cover your E&O insurance, provide unlimited warm leads to get started, and offer reimbursement for licensing costs once you're producing.",
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="py-24 relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,hsl(168_84%_42%/0.05)_0%,transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <SectionHeading
          badge="FAQ"
          title="Common Questions"
          subtitle="Everything you need to know about joining APEX Financial."
        />

        <motion.div
          className="max-w-3xl mx-auto mt-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="glass rounded-lg px-6 border-none"
              >
                <AccordionTrigger className="text-left hover:no-underline hover:text-primary py-6">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground pb-6">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
