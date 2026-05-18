"""Build the TheraVoca partner-facing deck PDF.

Run: python scripts/build_partner_pdf.py
Output: docs/partner-materials/TheraVoca-Overview.pdf

Audience: mixed (therapists, advisors, strategic partners). Tone: plain
English, concrete numbers, no pitch hype. ~10 pages.
"""
from __future__ import annotations

import os
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Brand palette -- pulled from the live React app's Tailwind tokens.
BRAND_GREEN = colors.HexColor("#2D4A3E")
BRAND_GREEN_LIGHT = colors.HexColor("#3A5E50")
BRAND_CORAL = colors.HexColor("#C87965")
INK = colors.HexColor("#2B2A29")
SUBTLE = colors.HexColor("#6D6A65")
CARD_BG = colors.HexColor("#FDFBF7")
LINE = colors.HexColor("#E8E5DF")
PALE_GREEN = colors.HexColor("#F2F7F1")
PALE_CORAL = colors.HexColor("#FBE9E5")

OUT_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "docs",
        "partner-materials",
        "TheraVoca-Overview.pdf",
    )
)
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)


def _styles():
    base = getSampleStyleSheet()
    s = {
        "Title": ParagraphStyle(
            "TVTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=36,
            leading=42,
            textColor=BRAND_GREEN,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "Tagline": ParagraphStyle(
            "TVTagline",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=14,
            leading=20,
            textColor=BRAND_CORAL,
            spaceAfter=24,
        ),
        "H1": ParagraphStyle(
            "TVH1",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=28,
            textColor=BRAND_GREEN,
            spaceBefore=12,
            spaceAfter=10,
        ),
        "H2": ParagraphStyle(
            "TVH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=18,
            textColor=BRAND_GREEN,
            spaceBefore=10,
            spaceAfter=4,
        ),
        "Kicker": ParagraphStyle(
            "TVKicker",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            leading=12,
            textColor=BRAND_CORAL,
            spaceAfter=2,
        ),
        "Body": ParagraphStyle(
            "TVBody",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=INK,
            spaceAfter=8,
            alignment=TA_LEFT,
        ),
        "BodySmall": ParagraphStyle(
            "TVBodySmall",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=14,
            textColor=SUBTLE,
            spaceAfter=6,
        ),
        "Bullet": ParagraphStyle(
            "TVBullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=INK,
            spaceAfter=4,
            leftIndent=14,
            bulletIndent=2,
        ),
        "PullQuote": ParagraphStyle(
            "TVPullQuote",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=12,
            leading=18,
            textColor=BRAND_GREEN,
            leftIndent=14,
            rightIndent=14,
            spaceBefore=8,
            spaceAfter=10,
        ),
        "Footer": ParagraphStyle(
            "TVFooter",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=SUBTLE,
            alignment=TA_CENTER,
        ),
        "CoverTitle": ParagraphStyle(
            "TVCoverTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=56,
            leading=64,
            textColor=BRAND_GREEN,
            alignment=TA_LEFT,
            spaceAfter=12,
        ),
        "CoverTagline": ParagraphStyle(
            "TVCoverTagline",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=18,
            leading=26,
            textColor=BRAND_CORAL,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "CoverMeta": ParagraphStyle(
            "TVCoverMeta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            leading=16,
            textColor=SUBTLE,
            alignment=TA_LEFT,
        ),
    }
    return s


def _page_decoration(canvas, doc):
    """Footer + thin top rule on every interior page."""
    canvas.saveState()
    # Skip the cover.
    if doc.page > 1:
        # Top thin rule.
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(
            0.75 * inch,
            LETTER[1] - 0.5 * inch,
            LETTER[0] - 0.75 * inch,
            LETTER[1] - 0.5 * inch,
        )
        # Footer text.
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(SUBTLE)
        canvas.drawString(
            0.75 * inch,
            0.45 * inch,
            "TheraVoca -- Overview for partners",
        )
        canvas.drawRightString(
            LETTER[0] - 0.75 * inch,
            0.45 * inch,
            f"Page {doc.page}",
        )
    canvas.restoreState()


def _cover_page(canvas, doc):
    """Custom cover with brand colors -- drawn directly on the first page."""
    # We use page_decoration for interior pages; the cover is handled
    # via flowables (title, tagline) plus a single colored bar at the
    # bottom for visual identity.
    canvas.saveState()
    # Big coral bar at bottom of cover.
    canvas.setFillColor(BRAND_CORAL)
    canvas.rect(0, 0, LETTER[0], 0.5 * inch, fill=1, stroke=0)
    canvas.restoreState()


def kv_table(rows, col_widths=None):
    """Build a label/value 2-column table styled as the body cards."""
    if col_widths is None:
        col_widths = [1.7 * inch, 4.3 * inch]
    t = Table(rows, colWidths=col_widths)
    t.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (1, 0), (1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("TEXTCOLOR", (0, 0), (0, -1), BRAND_GREEN),
                ("TEXTCOLOR", (1, 0), (1, -1), INK),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
            ]
        )
    )
    return t


def callout(text, color=BRAND_CORAL, bg=PALE_CORAL):
    """A colored callout box (left rule + tinted background)."""
    p = Paragraph(text, S["Body"])
    t = Table([[p]], colWidths=[6.0 * inch])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 3, color),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return t


S = _styles()


def _build():
    doc = SimpleDocTemplate(
        OUT_PATH,
        pagesize=LETTER,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
        title="TheraVoca -- Overview for partners",
        author="TheraVoca",
    )

    story = []

    # ============= COVER PAGE =============
    story.append(Spacer(1, 2.0 * inch))
    story.append(Paragraph("TheraVoca", S["CoverTitle"]))
    story.append(Paragraph(
        "A different way to find the right therapist.",
        S["CoverTagline"],
    ))
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph(
        "Free, anonymous therapist matching for Idaho.<br/>"
        "Built around fit, not directory size.",
        S["Body"],
    ))
    story.append(Spacer(1, 2.6 * inch))
    today = date.today().isoformat()
    story.append(Paragraph(
        f"Partner overview &nbsp;&middot;&nbsp; {today}<br/>"
        "Joshua Rosenthal, Founder<br/>"
        "therapymatch@gmail.com",
        S["CoverMeta"],
    ))
    story.append(PageBreak())

    # ============= PAGE 2: EXECUTIVE SUMMARY =============
    story.append(Paragraph("Executive summary", S["H1"]))
    story.append(Paragraph(
        "TheraVoca is a free service that helps people in Idaho find the "
        "right therapist in under ten minutes. A patient answers a short "
        "intake about what they're looking for; a scoring engine returns "
        "the three best-matched therapists, ranked by fit across thirteen "
        "different signals. The patient contacts the therapist directly. "
        "We are not in the room with them, and we never see clinical "
        "content.",
        S["Body"],
    ))
    story.append(Paragraph(
        "Therapists pay $45/month after a 30-day free trial. Patients pay "
        "nothing.",
        S["Body"],
    ))
    story.append(Paragraph(
        "The thesis is simple. Today's options for finding a therapist "
        "are bad. Insurance directories are riddled with inactive "
        "providers. Psychology Today is a paid listing with no fit "
        "signal. Word-of-mouth is reliable but doesn't scale. People "
        "give up. A small, vetted, actually-available pool of therapists "
        "matched against an honest intake outperforms a giant directory "
        "of cold leads.",
        S["Body"],
    ))
    story.append(callout(
        "<b>Where we are:</b> the platform is built. Patient intake, "
        "matching, therapist signup, admin tools, billing, and the "
        "compliance posture are all live on staging. Public launch is "
        "weeks away pending two external blockers: SMS carrier approval "
        "and DNS migration.",
        color=BRAND_GREEN,
        bg=PALE_GREEN,
    ))
    story.append(Spacer(1, 0.15 * inch))
    story.append(HRFlowable(width="100%", color=LINE, thickness=0.5))
    story.append(Spacer(1, 0.05 * inch))
    story.append(Paragraph("At-a-glance", S["H2"]))
    story.append(kv_table([
        ["Market", "Idaho, ~1.9M residents. ~1 in 5 adults needs a therapist; "
                   "~half of those who try to find one fail."],
        ["Patient cost", "Free."],
        ["Therapist cost", "$45/month, 30-day free trial. No setup fees, no per-referral fees."],
        ["Who's in the middle", "Nobody. Patient contacts therapist directly via email, phone, or booking link."],
        ["HIPAA posture", "Confirmed by attorney (2026-05-13): TheraVoca is NOT a Business Associate. We never receive PHI."],
        ["Status", "Pre-launch. Platform shipped to staging. Public launch weeks away."],
    ]))
    story.append(PageBreak())

    # ============= PAGE 3: THE PROBLEM =============
    story.append(Paragraph("The problem", S["H1"]))
    story.append(Paragraph(
        "Finding a therapist who fits you is harder than finding a "
        "doctor, a dentist, or a lawyer. Three reasons:",
        S["Body"],
    ))
    story.append(Paragraph("1. Directories are stale.", S["H2"]))
    story.append(Paragraph(
        "Independent audits of insurance \"find-a-provider\" lists show "
        "roughly half of listed therapists are unreachable, not "
        "accepting new patients, or no longer practicing. Patients "
        "burn through five or ten calls before getting a callback. "
        "Many quit.",
        S["Body"],
    ))
    story.append(Paragraph("2. The listings carry no fit signal.", S["H2"]))
    story.append(Paragraph(
        "Sites like Psychology Today let therapists buy a placement, "
        "list their modalities, and write a bio. There's no scoring of "
        "whether this therapist actually matches what you're looking "
        "for. The patient has to read fifteen profiles and guess.",
        S["Body"],
    ))
    story.append(Paragraph("3. The intake doesn't go anywhere.", S["H2"]))
    story.append(Paragraph(
        "When a patient does fill out a contact form, it lands in an "
        "inbox the therapist might not check for days. By then the "
        "patient has either given up or moved on to the next name on "
        "the list. The information they shared is gone.",
        S["Body"],
    ))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph(
        "<b>The net result:</b> people who decide to start therapy spend "
        "weeks looking, get matched on availability rather than fit, and "
        "often quit within the first three sessions because the "
        "relationship doesn't click. The downstream cost (untreated "
        "anxiety, depression, substance use) is enormous and falls on "
        "primary care, ERs, employers, and families.",
        S["Body"],
    ))
    story.append(PageBreak())

    # ============= PAGE 4: HOW IT WORKS (PATIENT) =============
    story.append(Paragraph("How it works -- the patient side", S["H1"]))
    story.append(Paragraph(
        "A patient who needs a therapist visits theravoca.com and "
        "answers four short sections of questions:",
        S["Body"],
    ))
    story.append(kv_table([
        ["1. What's going on", "Presenting issues (anxiety, depression, trauma, ADHD, relationship, etc). Urgency. Prior therapy history."],
        ["2. What fits your life", "In-person vs. telehealth, ZIP code, weekday vs. weekend, time of day."],
        ["3. How you pay", "Insurance plan + member ID, or cash with a budget. Sliding-scale openness."],
        ["4. Optional deeper questions", "Three open-text questions about how you describe what you're going through. Used for fit-based scoring; entirely optional."],
    ]))
    story.append(Paragraph(
        "After the patient hits submit, we don't show results "
        "immediately. A 24-hour soft hold lets us fan the request out "
        "to a small set of qualifying therapists. Therapists who can "
        "actually take a new client write a short personal apply "
        "message that becomes part of the patient's view.",
        S["Body"],
    ))
    story.append(Paragraph(
        "Twenty-four hours later, the patient sees their three top "
        "matches:",
        S["Body"],
    ))
    bullet_items = [
        "A match-fit percentage (transparent: the patient can see "
        "the top reasons we matched, and the top reasons we didn't).",
        "The therapist's photo, credentials, modalities, years of "
        "experience.",
        "A short \"Why we recommend\" blurb that ties the therapist's "
        "actual practice to what the patient described.",
        "Concrete logistics: office address with a map link, accepted "
        "insurance, cash rate, sliding scale, free consult availability, "
        "languages spoken.",
        "Contact buttons that open the patient's email, phone, or "
        "calendar app -- no in-app messaging.",
    ]
    for item in bullet_items:
        story.append(Paragraph(f"&bull;&nbsp; {item}", S["Bullet"]))
    story.append(callout(
        "<b>Important design decision:</b> the patient takes the next "
        "step. We don't book sessions, hold payments, or sit between "
        "the patient and the therapist. This is what keeps us outside "
        "of HIPAA's Business Associate scope, and it's the simplest "
        "version of \"matching done; rest is your relationship.\"",
        color=BRAND_CORAL,
        bg=PALE_CORAL,
    ))
    story.append(PageBreak())

    # ============= PAGE 5: HOW IT WORKS (THERAPIST) =============
    story.append(Paragraph("How it works -- the therapist side", S["H1"]))
    story.append(Paragraph(
        "Therapists sign up at theravoca.com/therapists/join and "
        "complete a nine-step profile. The profile is more detailed "
        "than typical directory listings because it powers the matching "
        "engine, not just the public page:",
        S["Body"],
    ))
    story.append(kv_table([
        ["Basics", "Name, credential type, email, public office phone, website, photo."],
        ["License", "Idaho license number, expiration date, license photo upload (verified by admin)."],
        ["Specialties", "Primary (the matchmaker's first axis), secondary, general."],
        ["Format + modalities", "Telehealth, in-person, or both. CBT, EMDR, DBT, IFS, etc."],
        ["Insurance + pricing", "Insurance plans accepted, cash rate, sliding-scale availability, free 15-minute consult."],
        ["Style + bio", "Style tags, a 200-300 word bio. AI-assisted draft option."],
        ["Deep-match signals", "Six open-text + multiple-choice questions about how the therapist works (used to score fit against the patient's deep-match answers)."],
    ]))
    story.append(Paragraph(
        "Every signup is manually reviewed before going live. License is "
        "verified against the Idaho DOPL public registry. The therapist "
        "gets a 30-day free trial, then $45/month via Stripe. They can "
        "pause matches at any time -- pausing during a busy stretch "
        "keeps them off the matching engine without canceling the "
        "subscription.",
        S["Body"],
    ))
    story.append(Paragraph(
        "When a new patient comes in whose criteria match a therapist's "
        "profile, the therapist gets an email and SMS alert with a "
        "deep-link. They write a personal note that becomes the "
        "patient-facing apply blurb. Patients see the therapists who "
        "actually want to work with them, with a message in their own "
        "voice, instead of a directory of cold profiles.",
        S["Body"],
    ))
    story.append(PageBreak())

    # ============= PAGE 6: THE MATCHING ENGINE =============
    story.append(Paragraph("The matching engine", S["H1"]))
    story.append(Paragraph(
        "Matching runs in two steps:",
        S["Body"],
    ))
    story.append(Paragraph("Step 1: Score every qualifying therapist against the patient", S["H2"]))
    story.append(Paragraph(
        "Each therapist gets a score from 0 to 95 based on thirteen "
        "weighted signals. The big ones:",
        S["Body"],
    ))
    story.append(kv_table([
        ["Issues fit (35 pts)", "Does the therapist specialize in the patient's primary concern?"],
        ["Availability (20 pts)", "Days and times the therapist works vs. when the patient is free."],
        ["Modality (15 pts)", "Telehealth, in-person, or both -- does it match the patient's preference?"],
        ["Deep-match resonance (15 pts)", "Semantic similarity between the patient's open-text answers and the therapist's lived-experience text. Powered by OpenAI embeddings."],
        ["Urgency (10 pts)", "Can the therapist take a new patient soon?"],
        ["Payment alignment (13 pts total)", "Insurance accepted + cash rate vs. budget + sliding scale."],
        ["Other signals (12 pts total)", "Prior-therapy history, gender preference, language, experience-level preference, style overlap."],
    ]))
    story.append(Paragraph("Step 2: Re-rank by ability to engage", S["H2"]))
    story.append(Paragraph(
        "Once we have a qualifying pool, we don't just sort by the "
        "Step 1 score. We re-rank based on signals about whether each "
        "therapist is actually likely to write a personal apply message "
        "and respond when the patient reaches out:",
        S["Body"],
    ))
    bullet_items_2 = [
        "Speed: how fast did the therapist apply on their last few matches?",
        "Apply-message quality: was the last message generic, or specific to that patient?",
        "Commitment: has the therapist toggled themselves available, or do they sit unread?",
    ]
    for item in bullet_items_2:
        story.append(Paragraph(f"&bull;&nbsp; {item}", S["Bullet"]))
    story.append(Paragraph(
        "The result: the patient sees three therapists who are both "
        "objectively a good fit AND have demonstrated they'll show up. "
        "The match-fit percentage and the \"Why we matched\" reasons "
        "are honest -- no marketing inflation -- and patients can see "
        "the gaps too (\"Where you may not align: this therapist doesn't "
        "take Blue Cross\"). Trust over hype.",
        S["Body"],
    ))
    story.append(PageBreak())

    # ============= PAGE 7: WHY IDAHO =============
    story.append(Paragraph("Why Idaho first", S["H1"]))
    story.append(Paragraph(
        "We're starting in one state on purpose. Going state-by-state "
        "gives us four advantages:",
        S["Body"],
    ))
    story.append(Paragraph("1. One license verification regime", S["H2"]))
    story.append(Paragraph(
        "Idaho DOPL (Department of Occupational and Professional "
        "Licensing) maintains a public registry of every licensed "
        "therapist. We verify every signup against it. Multi-state "
        "expansion adds one regime per state.",
        S["Body"],
    ))
    story.append(Paragraph("2. One set of laws", S["H2"]))
    story.append(Paragraph(
        "Telehealth rules, scope-of-practice, and HIPAA-adjacent state "
        "privacy laws vary. Idaho is straightforward. Adding a state "
        "means a legal review pass, not an open-ended question.",
        S["Body"],
    ))
    story.append(Paragraph("3. A finite, mappable provider pool", S["H2"]))
    story.append(Paragraph(
        "There are roughly 1,800 licensed mental health providers in "
        "Idaho across LCSW, LMFT, LPC, psychologists, and psychiatrists. "
        "Big enough that patients always have options; small enough that "
        "we can build relationships with the providers ourselves.",
        S["Body"],
    ))
    story.append(Paragraph("4. A real underserved-area story", S["H2"]))
    story.append(Paragraph(
        "Idaho has the second-lowest per-capita mental health "
        "professional count in the country. Telehealth-equipped "
        "therapists in Boise can serve patients in Coeur d'Alene, "
        "Pocatello, Twin Falls, and rural counties that have zero "
        "in-person options. Matching makes that geography problem "
        "solvable.",
        S["Body"],
    ))
    story.append(callout(
        "<b>The expansion plan, briefly:</b> stabilize Idaho first, "
        "then add a second state where the same playbook works "
        "(license verification + a state-of-the-art directory + clear "
        "regulatory ground). Most likely Oregon, Washington, or "
        "Montana given proximity and overlap. Each new state takes "
        "weeks, not months, because the platform is already built.",
        color=BRAND_GREEN,
        bg=PALE_GREEN,
    ))
    story.append(PageBreak())

    # ============= PAGE 8: COMPLIANCE & TRUST =============
    story.append(Paragraph("Compliance and trust", S["H1"]))
    story.append(Paragraph(
        "TheraVoca handles sensitive intake content. We took it "
        "seriously from day one, and we have an attorney's written "
        "opinion confirming where we sit:",
        S["Body"],
    ))
    story.append(Paragraph("HIPAA posture", S["H2"]))
    story.append(Paragraph(
        "Per attorney Mason, dated May 13 2026: <b>TheraVoca is NOT a "
        "HIPAA Business Associate today.</b> We don't receive Protected "
        "Health Information on behalf of a covered entity. Patients "
        "self-disclose to us before any therapist relationship exists. "
        "What we collect is their own information voluntarily shared "
        "with a private service.",
        S["Body"],
    ))
    story.append(Paragraph(
        "If we ever build features that move clinical data through us "
        "(session notes, clinical scheduling, billing on a provider's "
        "behalf), the BA analysis flips. We're explicit about staying "
        "clear of that line for the initial product.",
        S["Body"],
    ))
    story.append(Paragraph("Privacy practices", S["H2"]))
    bullet_items_3 = [
        "Patients are anonymous in our system. We key requests by an "
        "internal ID and email only -- never name.",
        "No session recordings. Our analytics tool's session-replay "
        "feature is globally disabled.",
        "Error tracking has automatic redaction: emails, phone numbers, "
        "and OTP codes are stripped before any error event leaves the "
        "server.",
        "We never put patient information in URL parameters, cookies, "
        "or third-party tracking pixels.",
        "Email allowlist + override mode during pre-launch testing so "
        "test sends can't reach real patient inboxes.",
    ]
    for item in bullet_items_3:
        story.append(Paragraph(f"&bull;&nbsp; {item}", S["Bullet"]))
    story.append(Paragraph("Therapist verification", S["H2"]))
    story.append(Paragraph(
        "Every therapist signup goes through manual admin review before "
        "matches go live. License number and photo are verified against "
        "the Idaho DOPL registry. Soft-flag risk gates on patient "
        "intake escalate certain content (active crisis language, "
        "minors, sexualized content directed at the therapist) to "
        "admin for review before matching runs.",
        S["Body"],
    ))
    story.append(PageBreak())

    # ============= PAGE 9: CURRENT STATE =============
    story.append(Paragraph("Current state", S["H1"]))
    story.append(Paragraph(
        "The platform is built. We're in pre-launch testing.",
        S["Body"],
    ))
    story.append(Paragraph("Shipped and live on staging", S["H2"]))
    shipped_items = [
        "Full patient intake (eight steps) with moderation gates.",
        "Full therapist signup (nine steps) with AI-assisted bio drafter.",
        "Matching engine with thirteen weighted signals and a two-step rank.",
        "24-hour soft-hold gate.",
        "Therapist portal: profile editor, application queue, availability toggles.",
        "Admin dashboard: request review with score breakdown, provider "
        "directory with patient-view preview, moderation queue, email "
        "template editor, cron schedule manager, audit log.",
        "Stripe subscriptions with webhook signing.",
        "Cloudflare Turnstile bot protection.",
        "Sentry error tracking with PII auto-redaction.",
        "Idaho-only license validation, geographic matching, ZIP-based distance scoring.",
        "Video testimonials via Cloudflare Stream.",
        "Email templates with quiet-hours guard (no sends before 8 AM Idaho time).",
    ]
    for item in shipped_items:
        story.append(Paragraph(f"&bull;&nbsp; {item}", S["Bullet"]))
    story.append(Paragraph("External blockers before public launch", S["H2"]))
    blocker_items = [
        "<b>SMS carrier approval (Telnyx CTIA / A2P 10DLC):</b> "
        "applied; pending vetting. Email alerts work today; SMS is the "
        "second channel and not blocking.",
        "<b>DNS migration:</b> theravoca.com domain points to a "
        "placeholder. We have the Render service configured but haven't "
        "flipped the DNS yet.",
        "<b>Initial therapist roster:</b> ~30-50 real therapists is the "
        "soft-launch minimum so patients see meaningful options. "
        "Currently a mix of test data and a handful of real early signups.",
    ]
    for item in blocker_items:
        story.append(Paragraph(f"&bull;&nbsp; {item}", S["Bullet"]))
    story.append(PageBreak())

    # ============= PAGE 10: WHAT WE'RE LOOKING FOR =============
    story.append(Paragraph("What we're looking for", S["H1"]))
    story.append(Paragraph(
        "Depending on the partnership, useful introductions land in one "
        "of four buckets:",
        S["Body"],
    ))
    story.append(Paragraph("1. Therapists who'd be willing early adopters", S["H2"]))
    story.append(Paragraph(
        "The first thirty to fifty therapists matter more than the "
        "next five hundred. We want providers who'll log in, write real "
        "apply messages, and give us feedback on what's missing. The "
        "30-day free trial covers their first month at zero cost.",
        S["Body"],
    ))
    story.append(Paragraph("2. Idaho-based referral sources", S["H2"]))
    story.append(Paragraph(
        "Primary care practices, school counseling offices, university "
        "wellness centers, employer assistance programs. Anyone who "
        "currently hands patients a stale list and hopes for the best. "
        "TheraVoca is a better referral destination -- patients get "
        "matched in ten minutes instead of fifteen calls.",
        S["Body"],
    ))
    story.append(Paragraph("3. Strategic / institutional partners", S["H2"]))
    story.append(Paragraph(
        "Insurers, hospital systems, telehealth platforms that need a "
        "fit-based referral layer. Our patient handoff model keeps us "
        "out of the clinical relationship, which means we can plug into "
        "a partner's existing intake or provider directory without "
        "triggering BA agreements or data-flow restructuring.",
        S["Body"],
    ))
    story.append(Paragraph("4. Advisors with operating experience", S["H2"]))
    story.append(Paragraph(
        "Founders or operators with experience in two-sided "
        "marketplaces, regulated healthcare, or Idaho-specific GTM. We "
        "have working product and a defensible scoring engine; we'd "
        "benefit from people who've grown a similar shape of business "
        "before.",
        S["Body"],
    ))
    story.append(Spacer(1, 0.2 * inch))
    story.append(HRFlowable(width="100%", color=LINE, thickness=0.5))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph("Contact", S["H2"]))
    story.append(Paragraph(
        "Joshua Rosenthal, Founder<br/>"
        "therapymatch@gmail.com<br/>"
        "Demo site: theravoca-production.onrender.com (staging; ask for the password)",
        S["Body"],
    ))
    story.append(Spacer(1, 0.3 * inch))
    story.append(Paragraph(
        "Generated " + date.today().isoformat() + ". "
        "This document is a snapshot; the platform ships changes daily.",
        S["Footer"],
    ))

    doc.build(story, onFirstPage=_cover_page, onLaterPages=_page_decoration)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    _build()
