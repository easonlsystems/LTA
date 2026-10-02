import { createHash } from 'node:crypto';

export const OPENAI_FIRST_PARTY_SKILL_NAME='use-lta-account-and-source-planning';
export const OPENAI_FIRST_PARTY_SKILL_DESCRIPTION="Use LTA to check source-format compatibility, estimate processing units, inspect supported source types, and read the connected user's LTA usage balance.";
export const OPENAI_FIRST_PARTY_SKILL_URI=`skill://lta/${OPENAI_FIRST_PARTY_SKILL_NAME}/SKILL.md`;

export const OPENAI_FIRST_PARTY_SKILL_MD=`---
name: use-lta-account-and-source-planning
description: Use LTA to check source-format compatibility, estimate processing units, inspect supported source types, and read the connected user's LTA usage balance.
---

LTA's public ChatGPT directory plugin is a first-party account and planning companion.

This distribution does not fetch, scrape, proxy, relay, summarize, transcribe, or return content from third-party websites or APIs.

Use these tools only when the user's request needs one of the following LTA-owned capabilities:
- \`check_link_support\` to classify whether a user-provided URL string matches an exact source format recognized by LTA. This performs local URL parsing only and does not contact the linked site.
- \`get_supported_sources\` to explain the current LTA source compatibility catalog.
- \`estimate_processing_units\` to estimate units from a duration or character count that the user supplied.
- \`get_usage\` to read the authenticated user's LTA plan and processing-unit balance.

Rules:
1. Do not invoke a tool merely because a URL appears in the conversation.
2. Never claim that \`check_link_support\` read, opened, verified, fetched, or inspected the contents behind a URL.
3. If the user asks what an external link says, asks for a summary/transcript, or otherwise needs the source contents, do not pretend this LTA directory plugin can provide them. Explain that this public-directory distribution only provides LTA compatibility/account/planning functions.
4. \`get_supported_sources\` describes capabilities of the broader LTA product. It does not make those external sources readable through this ChatGPT directory plugin.
5. For \`estimate_processing_units\`, use only size or duration values supplied by the user. Do not fetch a URL to discover those values.
6. \`get_usage\` returns first-party LTA account data. Do not expose raw auth data, internal identifiers, concurrency state, exemption flags, server logs, or database details.
7. Do not initiate, promote, or provide checkout, purchase, subscription, upgrade, top-up, or transaction links from ChatGPT.
8. The ChatGPT distribution is general-audience only. If LTA reports a URL is outside the general-audience scope, do not retry it or infer details about its content.
9. Keep internal MCP plumbing out of normal user-facing answers.
`;

export const OPENAI_FIRST_PARTY_SKILL_DIGEST=`sha256:${createHash('sha256').update(OPENAI_FIRST_PARTY_SKILL_MD,'utf8').digest('hex')}`;

export function openAiFirstPartySkillEntry(){
  return {
    uri:OPENAI_FIRST_PARTY_SKILL_URI,
    frontmatter:{
      name:OPENAI_FIRST_PARTY_SKILL_NAME,
      description:OPENAI_FIRST_PARTY_SKILL_DESCRIPTION
    },
    resources:[{
      uri:OPENAI_FIRST_PARTY_SKILL_URI,
      digest:OPENAI_FIRST_PARTY_SKILL_DIGEST
    }]
  };
}
