# Officer sign-off. Keep this in lockstep with server/signoff/policy.ts.
# A signature records a decision. It does not certify HIPAA, ISO, or GDPR.
# CloudBot posts { "input": ... } to POST /v1/data/cloudbot/signoff/decision.
# `verified` is already decided by the server (external cosign/witness command, or trust-local).
package cloudbot.signoff

decision := evaluate if {
	true
}

evaluate := {"allow": false, "reason": "Sign-off required: policy file is invalid"} if {
	not policy_ok
} else := {"allow": false, "reason": "Sign-off required: policy file has no required roles"} if {
	count(input.policy.requiredRoles) == 0
} else := {"allow": true} if {
	action_skipped
} else := {"allow": false, "reason": server_policy_reason} if {
	policy_server_mismatch
} else := {"allow": false, "reason": provider_policy_reason} if {
	policy_provider_blocked
} else := {"allow": false, "reason": role_reason(missing_role)} if {
	missing_role != ""
} else := {"allow": true}

policy_ok if {
	is_object(input.policy)
	is_array(input.policy.requiredRoles)
	every role in input.policy.requiredRoles {
		is_string(role)
		role != ""
	}
	list_of_strings(object.get(input.policy, "frameworks", null))
	list_of_strings(object.get(input.policy, "allowedProviders", null))
	server_field_ok
	actions_ok
	is_number(input.now)
}

server_field_ok if {
	not input.policy.server
}

server_field_ok if {
	is_string(input.policy.server)
}

list_of_strings(value) if {
	value == null
}

list_of_strings(value) if {
	is_array(value)
	every item in value {
		is_string(item)
	}
}

actions_ok if {
	not input.policy.actions
}

actions_ok if {
	is_array(input.policy.actions)
	count(input.policy.actions) == 0
}

actions_ok if {
	is_array(input.policy.actions)
	every item in input.policy.actions {
		is_string(item)
	}
	some action in input.policy.actions
	action == "bot_turn"
}

actions_ok if {
	is_array(input.policy.actions)
	every item in input.policy.actions {
		is_string(item)
	}
	some action in input.policy.actions
	action == "full_access"
}

actions_ok if {
	is_array(input.policy.actions)
	every item in input.policy.actions {
		is_string(item)
	}
	some action in input.policy.actions
	action == "model_call"
}

action_skipped if {
	is_array(input.policy.actions)
	count(input.policy.actions) > 0
	not input.action in input.policy.actions
}

hostname := input.server if {
	is_string(input.server)
} else := ""

policy_server_mismatch if {
	is_string(input.policy.server)
	input.policy.server != ""
	input.policy.server != hostname
}

server_policy_reason := sprintf("Sign-off required: role '%s' has no valid signature (server mismatch: policy is for \"%s\", this server is \"%s\")", [input.policy.requiredRoles[0], input.policy.server, hostname])

provider_text := input.modelProvider if {
	is_string(input.modelProvider)
} else := ""

policy_provider_blocked if {
	input.action != "full_access"
	is_array(input.policy.allowedProviders)
	count(input.policy.allowedProviders) > 0
	not provider_allowed(provider_text, input.policy.allowedProviders)
}

provider_policy_reason := sprintf("Sign-off required: role '%s' has no valid signature (provider '%s' is not allowed)", [input.policy.requiredRoles[0], provider_text])

provider_allowed(name, allow) if {
	is_string(name)
	name != ""
	some entry in allow
	is_string(entry)
	lower(entry) == lower(name)
}

provider_allowed(name, allow) if {
	is_string(name)
	name != ""
	some entry in allow
	is_string(entry)
	canonical(entry) == canonical(name)
}

canonical(name) := "anthropic" if {
	lower(name) in {"claude", "claudeagent", "anthropic"}
} else := "openai" if {
	lower(name) in {"openai", "openai-compat", "openaicompat", "codex"}
} else := "xai" if {
	lower(name) in {"xai", "grok", "grokagent"}
} else := lower(name)

missing_role := role if {
	roles := [name |
		some name in input.policy.requiredRoles
		not role_ok(name)
		not earlier_missing(name)
	]
	count(roles) > 0
	role := roles[0]
} else := ""

earlier_missing(name) if {
	some i, candidate in input.policy.requiredRoles
	candidate == name
	some j
	j < i
	not role_ok(input.policy.requiredRoles[j])
}

role_ok(role) if {
	some att in input.attestations
	valid_att(role, att)
}

valid_att(role, att) if {
	att.verified == true
	att.predicate.role == role
	dated(att)
	not expired(att)
	server_ok(att)
	frameworks_ok(att)
	att_provider_ok(att)
}

dated(att) if {
	expiry_ns(att.predicate.expiresAt)
}

expired(att) if {
	ns := expiry_ns(att.predicate.expiresAt)
	ns <= input.now * 1000000
}

expiry_ns(value) := time.parse_rfc3339_ns(sprintf("%sT00:00:00Z", [value])) if {
	is_string(value)
	regex.match(`^\d{4}-\d{2}-\d{2}$`, value)
}

expiry_ns(value) := time.parse_rfc3339_ns(value) if {
	is_string(value)
	not regex.match(`^\d{4}-\d{2}-\d{2}$`, value)
	regex.match(`^\d{4}-\d{2}-\d{2}T`, value)
}

server_ok(att) if {
	is_string(input.policy.server)
	input.policy.server != ""
	att.predicate.server == input.policy.server
}

server_ok(att) if {
	not policy_server_set
	is_string(att.predicate.server)
	att.predicate.server != ""
	att.predicate.server == hostname
}

server_ok(att) if {
	not policy_server_set
	not attestation_server_set(att)
}

policy_server_set if {
	is_string(input.policy.server)
	input.policy.server != ""
}

attestation_server_set(att) if {
	is_string(att.predicate.server)
	att.predicate.server != ""
}

frameworks_ok(att) if {
	not is_array(input.policy.frameworks)
}

frameworks_ok(att) if {
	is_array(input.policy.frameworks)
	count(input.policy.frameworks) == 0
}

frameworks_ok(att) if {
	is_array(input.policy.frameworks)
	count(input.policy.frameworks) > 0
	every want in input.policy.frameworks {
		some have in object.get(att.predicate, "frameworks", [])
		lower(have) == lower(want)
	}
}

att_provider_ok(att) if {
	input.action == "full_access"
}

att_provider_ok(att) if {
	input.action != "full_access"
	not is_array(att.predicate.allowedProviders)
}

att_provider_ok(att) if {
	input.action != "full_access"
	is_array(att.predicate.allowedProviders)
	count(att.predicate.allowedProviders) == 0
}

att_provider_ok(att) if {
	input.action != "full_access"
	is_array(att.predicate.allowedProviders)
	count(att.predicate.allowedProviders) > 0
	provider_allowed(provider_text, att.predicate.allowedProviders)
}

role_reason(role) := sprintf("Sign-off required: role '%s' has no valid signature (expired %s)", [role, expired_day(role)]) if {
	expired_day(role) != ""
} else := sprintf("Sign-off required: role '%s' has no valid signature (server mismatch: signature is for \"%s\", this server is \"%s\")", [role, object.get(server_failure(role).predicate, "server", "")]) if {
	server_failure(role)
} else := sprintf("Sign-off required: role '%s' has no valid signature (provider '%s' is not allowed)", [role, provider_text]) if {
	provider_failure(role)
} else := sprintf("Sign-off required: role '%s' has no valid signature (unverified)", [role]) if {
	unverified_only(role)
} else := sprintf("Sign-off required: role '%s' has no valid signature", [role])

expired_day(role) := day if {
	days := [stamp |
		some att in input.attestations
		att.predicate.role == role
		att.verified == true
		expired(att)
		stamp := expiry_day(att)
	]
	count(days) > 0
	ordered := sort(days)
	day := ordered[count(ordered) - 1]
} else := ""

expiry_day(att) := substring(att.predicate.expiresAt, 0, 10) if {
	regex.match(`^\d{4}-\d{2}-\d{2}`, att.predicate.expiresAt)
}

server_failure(att_role) := att if {
	found := [candidate |
		some candidate in input.attestations
		candidate.predicate.role == att_role
		candidate.verified == true
		dated(candidate)
		not expired(candidate)
		not server_ok(candidate)
	]
	count(found) > 0
	att := found[0]
}

provider_failure(role) if {
	some att in input.attestations
	att.predicate.role == role
	att.verified == true
	dated(att)
	not expired(att)
	server_ok(att)
	frameworks_ok(att)
	not att_provider_ok(att)
}

unverified_only(role) if {
	some att in input.attestations
	att.predicate.role == role
	not verified_for_role(role)
}

verified_for_role(role) if {
	some att in input.attestations
	att.predicate.role == role
	att.verified == true
}
