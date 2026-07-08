import streamlit as st
import asyncio
import json
import pandas as pd
from main import run_single_test_async, run_all_tests_async, list_available_conversations, list_past_runs
from core.config import DAS_ENVIRONMENTS
from core.db import get_past_runs, get_test_results_for_batch, update_test_result_override

st.set_page_config(page_title="DAS Tester", page_icon="🧪", layout="wide")

def run_async(coroutine):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    return loop.run_until_complete(coroutine)

st.title("Chemille DAS 2.0 Testing System")

# Sidebar Configuration
st.sidebar.header("Configuration")
das_env = st.sidebar.selectbox("DAS Environment", list(DAS_ENVIRONMENTS.keys()), index=0)
num_rounds = st.sidebar.slider("Number of Iterations (Rounds)", min_value=1, max_value=20, value=1)
use_llm_eval = st.sidebar.toggle("Use LLM Evaluation", value=True)

test_mode = st.sidebar.radio("Test Mode", ["Single Conversation", "All Conversations"])

available_convs = list_available_conversations()
selected_conv = None
if test_mode == "Single Conversation":
    selected_conv = st.sidebar.selectbox("Select Conversation", available_convs)

tabs = st.tabs(["Run Test", "Results Viewer", "Overview Dashboard", "Accuracy Diff (WIP)"])

with tabs[0]:
    st.header("Run Tests")
    
    if st.button("🚀 Run Test", type="primary"):
        # Progress UI
        progress_bar = st.progress(0)
        status_text = st.empty()
        log_container = st.container(height=400)
        
        def on_progress(event_type, data):
            if event_type == "round_start":
                status_text.text(f"Starting Round {data['round']}...")
            elif event_type == "file_start":
                status_text.text(f"Testing {data['conv_file']} ({data['index']}/{data['total']})...")
                progress_bar.progress(data['index'] / data['total'])
            elif event_type == "turn_start":
                with log_container:
                    st.write(f"**[{data['conv_no']}] Turn {data['turn']} (User):** {data['user_input']}")
            elif event_type == "agent_reply":
                with log_container:
                    st.write(f"**[{data['conv_no']}] Turn {data['turn']} (Agent):** {data['agent_msg']}")
            elif event_type == "evaluating":
                status_text.text(f"Evaluating results for Conv {data['conv_no']}...")
            elif event_type == "completed":
                status_text.text(f"Completed Conv {data['conv_no']}. Success: {data['success']}")

        with st.spinner("Running tests..."):
            if test_mode == "Single Conversation" and selected_conv:
                conv_file = Path("conversation") / selected_conv
                out_dir = run_async(run_single_test_async(conv_file, num_rounds, use_llm_eval, das_env, on_progress))
            else:
                out_dir = run_async(run_all_tests_async(num_rounds, use_llm_eval, das_env, on_progress))
            
            st.success(f"Testing complete! Results saved to `{out_dir}`")
            with open(out_dir / "consolidated_report.xlsx", "rb") as f:
                st.download_button(
                    label="📊 Download Excel Report",
                    data=f,
                    file_name="consolidated_report.xlsx",
                    mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    type="primary"
                )

with tabs[1]:
    st.header("Past Runs Viewer (SQLite)")
    
    # 1. Fetch from DB instead of listing folders
    past_runs = get_past_runs()
    
    if not past_runs:
        st.info("No full batch runs found in the database yet.")
    else:
        # Convert to pandas dataframe for nice display
        df_runs = pd.DataFrame(past_runs)
        st.subheader("Batch Run History")
        st.dataframe(df_runs, use_container_width=True, hide_index=True)
        
        selected_run_id = st.selectbox("Select a Batch Run ID to view details", [r['id'] for r in past_runs])
        
        if selected_run_id:
            st.subheader(f"Results for Batch ID {selected_run_id}")
            results = get_test_results_for_batch(selected_run_id)
            
            if results:
                df_results = pd.DataFrame(results)
                
                # Show aggregate stats in columns
                col1, col2 = st.columns(2)
                col1.metric("Avg Grade Accuracy", f"{df_runs[df_runs['id'] == selected_run_id]['grade_accuracy_avg'].values[0]:.1f}%")
                col2.metric("Avg Assumption Score", f"{df_runs[df_runs['id'] == selected_run_id]['assumption_score_avg'].values[0]:.2f} / 10")
                
                # Show variance per round if multiple rounds exist
                if df_results['round_no'].nunique() > 1:
                    st.subheader("Variance Across Rounds")
                    round_stats = df_results.groupby('round_no').agg(
                        grade_accuracy=('grades_passed', lambda x: x.mean() * 100),
                        assumption_score=('assumptions_score', 'mean')
                    ).reset_index()
                    st.line_chart(round_stats.set_index('round_no'))
                
                st.write("Detailed Conversation Results:")
                display_cols = ['round_no', 'conversation_no', 'application_name', 'grades_passed', 'assumptions_score', 'flow_completed', 'conversation_id']
                st.dataframe(df_results[display_cols], use_container_width=True, hide_index=True)
                
                st.subheader("Explore & Override Specific Conversation")
                colA, colB = st.columns(2)
                with colA:
                    selected_conv_no = st.selectbox("Select Conversation No.", sorted(df_results['conversation_no'].unique()))
                with colB:
                    selected_round_no = st.selectbox("Select Round", sorted(df_results['round_no'].unique()))
                
                specific_result = df_results[(df_results['conversation_no'] == selected_conv_no) & (df_results['round_no'] == selected_round_no)]
                if not specific_result.empty:
                    res = specific_result.iloc[0]
                    st.write("**Application:**", res['application_name'])
                    st.write("**Expected Grades:**", res['expected_grades'])
                    st.write("**Suggested Grades:**", res['suggested_grades'])
                    st.write("**Expected Assumptions (CTQs):**", res.get('expected_assumptions', []))
                    st.write("**Agent Assumptions Output:**")
                    st.info(res.get('agent_assumptions', 'No assumptions output'))
                    
                    st.divider()
                    st.subheader("Manual Evaluator Override")
                    st.caption("If the evaluator agent made a mistake, you can manually correct the results here. The batch accuracy will be instantly recalculated.")
                    
                    with st.form("override_form"):
                        current_grade_pass = bool(res['grades_passed']) if pd.notnull(res['grades_passed']) else False
                        current_score = float(res['assumptions_score']) if pd.notnull(res['assumptions_score']) else 0.0
                        
                        new_grade = st.checkbox("Grades Passed?", value=current_grade_pass)
                        new_score = st.number_input("Assumption Score (0-10)", min_value=0.0, max_value=10.0, value=current_score, step=0.5)
                        
                        if st.form_submit_button("Update Result"):
                            update_test_result_override(int(res['id']), new_grade, new_score)
                            st.success("Result updated successfully!")
                            st.rerun()
            else:
                st.warning("No results found for this batch.")

with tabs[2]:
    st.header("Batch Overview Dashboard")
    
    past_runs = get_past_runs()
    if not past_runs:
        st.info("No runs available.")
    else:
        selected_overview_id = st.selectbox("Select Batch Run", [r['id'] for r in past_runs], key="overview_batch")
        if selected_overview_id:
            results = get_test_results_for_batch(selected_overview_id)
            if results:
                df = pd.DataFrame(results)
                
                st.subheader("Grade Pass/Fail Heatmap")
                
                # Map True/False to PASS/FAIL
                df['grade_status'] = df['grades_passed'].map({True: 'PASS', False: 'FAIL', None: 'N/A'})
                
                # Pivot
                pivot = df.pivot(index=['conversation_no', 'application_name'], columns='round_no', values='grade_status')
                pivot.columns = [f"round{c}" for c in pivot.columns]
                
                # Row-wise aggregations
                pass_counts = (pivot == 'PASS').sum(axis=1)
                fail_counts = (pivot == 'FAIL').sum(axis=1)
                total_counts = pass_counts + fail_counts
                scores = (pass_counts / total_counts * 100).fillna(0)
                
                pivot['PASS'] = pass_counts
                pivot['FAIL'] = fail_counts
                pivot['Score'] = scores.map("{:.1f}%".format)
                pivot['>80%'] = scores.apply(lambda x: "Yes" if x >= 80 else "No")
                pivot['>70%'] = scores.apply(lambda x: "Yes" if x >= 70 else "No")
                pivot['>60%'] = scores.apply(lambda x: "Yes" if x >= 60 else "No")
                
                pivot = pivot.reset_index()
                
                # Column-wise bottom summaries
                summary_pass = {"conversation_no": "", "application_name": "PASS"}
                summary_fail = {"conversation_no": "", "application_name": "FAIL"}
                summary_score = {"conversation_no": "", "application_name": "Score"}
                
                round_cols = [c for c in pivot.columns if c.startswith('round')]
                for col in round_cols:
                    p_cnt = (pivot[col] == 'PASS').sum()
                    f_cnt = (pivot[col] == 'FAIL').sum()
                    summary_pass[col] = p_cnt
                    summary_fail[col] = f_cnt
                    summary_score[col] = f"{(p_cnt / (p_cnt + f_cnt) * 100):.1f}%" if (p_cnt + f_cnt) > 0 else "0.0%"
                    
                # Append summaries
                pivot = pd.concat([pivot, pd.DataFrame([summary_pass, summary_fail, summary_score])], ignore_index=True)
                
                # Color styling
                def color_cells(val):
                    if val in ['PASS', 'Yes']:
                        return 'background-color: #8FD14F; color: black'
                    elif val in ['FAIL', 'No']:
                        return 'background-color: #FC8A8C; color: black'
                    elif isinstance(val, str) and '%' in val:
                        try:
                            num = float(val.strip('%'))
                            if num >= 80: return 'background-color: #8FD14F; color: black'
                            elif num >= 60: return 'background-color: #FFD580; color: black'
                            else: return 'background-color: #FC8A8C; color: black'
                        except:
                            pass
                    return ''
                
                # Use map instead of applymap for newer pandas
                styled_pivot = pivot.style.map(color_cells)
                st.dataframe(styled_pivot, use_container_width=True, hide_index=True)
                
                st.divider()
                st.subheader("Performance Charts")
                col1, col2 = st.columns(2)
                with col1:
                    st.write("**Average Grade Pass Rate per Round**")
                    round_scores = df.groupby('round_no')['grades_passed'].mean() * 100
                    st.bar_chart(round_scores)
                
                with col2:
                    st.write("**Average Assumption Score per Round**")
                    round_assumps = df.groupby('round_no')['assumptions_score'].mean()
                    st.line_chart(round_assumps)

with tabs[3]:
    st.header("Accuracy Diff (Coming Soon)")
    st.info("This feature will allow you to compare the accuracy of a new run against a previous baseline run.")
