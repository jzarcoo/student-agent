"""
Architecture diagram for the UNAM Student Agent.
Run: python3 docs/generate_architecture.py
Output: docs/architecture.png
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import APIGateway
from diagrams.aws.database import Dynamodb
from diagrams.aws.storage import S3
from diagrams.aws.integration import SQS, SNS, Eventbridge
from diagrams.aws.management import Cloudwatch
from diagrams.aws.security import IAM
from diagrams.aws.ml import Sagemaker
from diagrams.onprem.client import User

OUTPUT = "docs/architecture"

graph_attr = {
    "fontsize": "13",
    "bgcolor": "#0a1628",
    "fontcolor": "#eaf1f8",
    "pad": "0.8",
    "splines": "ortho",
    "nodesep": "0.6",
    "ranksep": "1.0",
}

node_attr = {
    "fontsize": "11",
    "fontcolor": "#eaf1f8",
}

cluster_attr = {
    "fontsize": "12",
    "fontcolor": "#eaf1f8",
    "bgcolor": "#112240",
    "style": "rounded",
}

with Diagram(
    "UNAM Student Agent - Architecture",
    filename=OUTPUT,
    show=False,
    direction="LR",
    graph_attr=graph_attr,
    node_attr=node_attr,
):

    user = User("Student\n(Browser)")

    with Cluster("API Layer", graph_attr=cluster_attr):
        apigw = APIGateway("API Gateway\nREST (streaming)\nGET /  POST /chat")

    with Cluster("Compute Layer", graph_attr=cluster_attr):

        with Cluster("Orchestrator Lambda\nunam-agent-orchestrator", graph_attr=cluster_attr):
            orchestrator = Lambda("Agent\nOrchestrator")

            with Cluster("Agent Tools", graph_attr={**cluster_attr, "bgcolor": "#0d1e35"}):
                tool_schedule    = Lambda("plan_schedule\n(constraint solver)")
                tool_professor   = Lambda("research_professor")
                tool_progress    = Lambda("check_academic_progress\n(credit calculator)")
                tool_goals       = Lambda("get_student_goals")

        with Cluster("Background Lambdas", graph_attr=cluster_attr):
            scraper  = Lambda("unam-scraper\n(SQS consumer)")
            refresher = Lambda("unam-schedule-refresh\n(EventBridge cron)")

    with Cluster("AI / ML", graph_attr=cluster_attr):
        bedrock = Sagemaker("Amazon Bedrock\nClaude Haiku 4.5\n(LLM orchestration)")

    with Cluster("Data Layer", graph_attr=cluster_attr):
        ddb_students    = Dynamodb("unam-students\n(profile, progress,\ngoals, schedule prefs)")
        ddb_courses     = Dynamodb("unam-courses\n(catalog, groups,\nsections per semester)")
        ddb_professors  = Dynamodb("unam-professors\n(profiles, review\ncache with TTL)")
        ddb_roadmaps    = Dynamodb("unam-roadmaps\n(career goal nodes\n& UNAM course links)")
        ddb_sessions    = Dynamodb("unam-sessions\n(conversation\nhistory with TTL)")

    with Cluster("Storage", graph_attr=cluster_attr):
        s3 = S3("unam-rag-corpus\n(PDFs, crawled docs,\nreview cache)")

    with Cluster("Async / Events", graph_attr=cluster_attr):
        sqs_scraping = SQS("unam-scraping-queue\n(scraping jobs)")
        sqs_dlq      = SQS("unam-scraping-dlq\n(failed jobs)")
        sqs_notif    = SQS("unam-notification-queue")
        eb           = Eventbridge("EventBridge\nnightly cron 05:00 UTC")
        sns          = SNS("unam-student-\nnotifications")

    with Cluster("Observability & Security", graph_attr=cluster_attr):
        cw  = Cloudwatch("CloudWatch\nLogs + DLQ Alarm")
        iam = IAM("IAM Roles\n+ Permissions Boundary\nhackathon-boundary")

    # --- Request flow ---
    user >> Edge(label="HTTPS\nGET /  POST /chat", color="#006847") >> apigw
    apigw >> Edge(label="streaming invoke", color="#006847") >> orchestrator

    # Orchestrator calls Bedrock
    orchestrator >> Edge(label="InvokeModel\n(stream)", color="#ff9900") >> bedrock
    bedrock >> Edge(color="#ff9900") >> orchestrator

    # Orchestrator uses tools
    orchestrator >> Edge(color="#4a9eff", style="dashed") >> tool_schedule
    orchestrator >> Edge(color="#4a9eff", style="dashed") >> tool_professor
    orchestrator >> Edge(color="#4a9eff", style="dashed") >> tool_progress
    orchestrator >> Edge(color="#4a9eff", style="dashed") >> tool_goals

    # Tools read DynamoDB
    tool_schedule   >> Edge(label="Query groups", color="#ce1126") >> ddb_courses
    tool_professor  >> Edge(label="Get profile\n+ reviews", color="#ce1126") >> ddb_professors
    tool_progress   >> Edge(label="Query completed\ncourses", color="#ce1126") >> ddb_students
    tool_goals      >> Edge(label="Get profile", color="#ce1126") >> ddb_students
    tool_schedule   >> Edge(label="Get prefs", color="#ce1126") >> ddb_students
    tool_goals      >> Edge(color="#ce1126") >> ddb_roadmaps

    # Session persistence
    orchestrator >> Edge(label="Load / save\nsession", color="#8ba3bc") >> ddb_sessions

    # Background flow
    eb >> Edge(label="nightly 05:00", color="#ff9900") >> refresher
    refresher >> Edge(label="enqueue jobs", color="#ff9900") >> sqs_scraping
    sqs_scraping >> Edge(label="trigger", color="#ff9900") >> scraper
    scraper >> Edge(label="write course\n& professor data", color="#ff9900") >> ddb_courses
    scraper >> Edge(color="#ff9900") >> ddb_professors
    scraper >> Edge(label="cache docs", color="#ff9900") >> s3
    sqs_scraping >> Edge(label="on failure\n(3 retries)", color="#a33") >> sqs_dlq

    # Notifications
    sns >> Edge(color="#8ba3bc") >> sqs_notif

    # Observability
    orchestrator >> Edge(color="#8ba3bc", style="dotted") >> cw
    scraper      >> Edge(color="#8ba3bc", style="dotted") >> cw
    sqs_dlq      >> Edge(label="alarm", color="#a33", style="dotted") >> cw

    # IAM governs all lambdas
    iam >> Edge(color="#8ba3bc", style="dotted") >> orchestrator
    iam >> Edge(color="#8ba3bc", style="dotted") >> scraper
    iam >> Edge(color="#8ba3bc", style="dotted") >> refresher


print("Diagram written to docs/architecture.png")
