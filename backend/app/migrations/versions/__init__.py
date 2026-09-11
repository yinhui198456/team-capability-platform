from .v0001_standard_targets import upgrade as upgrade_standard_targets
from .v0002_assessment_inheritance_revision import (
    upgrade as upgrade_assessment_inheritance_revision,
)
from .v0003_assessment_explicit_clear import (
    upgrade as upgrade_assessment_explicit_clear,
)
from .v0004_legacy_draft_target_repair import (
    upgrade as upgrade_legacy_draft_target_repair,
)
from .v0005_capability_standard_versioning import (
    upgrade as upgrade_capability_standard_versioning,
)
from .v0006_assessment_scope_snapshots import (
    upgrade as upgrade_assessment_scope_snapshots,
)
from .v0007_assessment_plan_selection import (
    upgrade as upgrade_assessment_plan_selection,
)
from .v0008_plan_null_constraint import (
    upgrade as upgrade_plan_null_constraint,
)
from .v0009_review_plan_atomic import upgrade as upgrade_review_plan_atomic
from .v0010_learning_execution import upgrade as upgrade_learning_execution
from .v0011_monthly_review import upgrade as upgrade_monthly_review
from .v0012_team_analytics_indexes import (
    upgrade as upgrade_team_analytics_indexes,
)
from .v0013_plan_item_growth_goal_nullable import (
    upgrade as upgrade_plan_item_growth_goal_nullable,
)
from .v0014_evidence_archive_backfill import (
    upgrade as upgrade_evidence_archive_backfill,
)
from .v0015_plan_draft_pending_month import (
    upgrade as upgrade_plan_draft_pending_month,
)

MIGRATIONS = [
    ("0001_standard_targets", upgrade_standard_targets),
    (
        "0002_assessment_inheritance_revision",
        upgrade_assessment_inheritance_revision,
    ),
    ("0003_assessment_explicit_clear", upgrade_assessment_explicit_clear),
    ("0004_legacy_draft_target_repair", upgrade_legacy_draft_target_repair),
    ("0005_capability_standard_versioning", upgrade_capability_standard_versioning),
    ("0006_assessment_scope_snapshots", upgrade_assessment_scope_snapshots),
    ("0007_assessment_plan_selection", upgrade_assessment_plan_selection),
    ("0008_plan_null_constraint", upgrade_plan_null_constraint),
    ("0009_review_plan_atomic", upgrade_review_plan_atomic),
    ("0010_learning_execution", upgrade_learning_execution),
    ("0011_monthly_review", upgrade_monthly_review),
    ("0012_team_analytics_indexes", upgrade_team_analytics_indexes),
    (
        "0013_plan_item_growth_goal_nullable",
        upgrade_plan_item_growth_goal_nullable,
    ),
    (
        "0014_evidence_archive_backfill",
        upgrade_evidence_archive_backfill,
    ),
    (
        "0015_plan_draft_pending_month",
        upgrade_plan_draft_pending_month,
    ),
]

__all__ = ["MIGRATIONS"]
