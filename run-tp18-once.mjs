import { AzureClient } from "./AzureClient.js";

const s = (a, e) => ({ action: a, expected: e });

const test_cases = [
  {
    title: "[Happy Path] PythonFileReader — read MaorAzureSkillTest/filereader.py from repo root",
    steps: [
      s("Instantiate PythonFileReader() with base_repo_path '.' at repo root.", "state is IDLE."),
      s("Call read('MaorAzureSkillTest/filereader.py').", "Returns status 'success', content_length > 0, file_path matches input."),
      s("Assert reader.state after successful return.", "state equals COMPLETED (line 87)."),
      s("Inspect documentation.module_doc and documentation.functions keys.", "functions includes read, PythonFileReader, _validate_path."),
      s("Confirm _validate_path and _check_suffix completed without exception.", "No InvalidPathError or UnsupportedSuffixError."),
    ],
  },
  {
    title: "[Happy Path] PythonFileReader — base_repo_path MaorAzureSkillTest and read('filereader.py')",
    steps: [
      s("Construct PythonFileReader('MaorAzureSkillTest').", "state IDLE; base_repo_path stored."),
      s("Call read('filereader.py').", "status 'success'; returned file_path is 'filereader.py'."),
      s("Verify os.path.join produced an existing absolute path.", "_validate_path returns without error."),
      s("Read documentation.functions['_check_suffix'].", "Docstring mentions suffix routing (AC-2)."),
      s("Check INFO logs for start and success messages.", "logger.info lines from read() executed."),
    ],
  },
  {
    title: "[Negative] PythonFileReader — empty path raises ValueError and ERROR state",
    steps: [
      s("Create PythonFileReader() and invoke read('').", "Raises ValueError: File path cannot be empty."),
      s("Read reader.state after catching the exception.", "state is ERROR from _validate_path."),
      s("Invoke read('   ') (whitespace only).", "Same ValueError and ERROR state."),
      s("Confirm no success dict returned.", "No status success payload."),
      s("Relate failure to _validate_path guard not file_path.strip().", "Guard at lines 28–30 triggers."),
    ],
  },
  {
    title: "[Negative] PythonFileReader — missing file raises InvalidPathError with full_path text",
    steps: [
      s("PythonFileReader('.') then read('MaorAzureSkillTest/nonexistent_tp18.py').", "Raises InvalidPathError."),
      s("Inspect exception message.", "Starts with Target file not found at: and includes joined full_path."),
      s("Read reader.state.", "ERROR from _validate_path."),
      s("Confirm _check_suffix not executed.", "No UnsupportedSuffixError."),
      s("Verify read() did not return content_length.", "Failure before open() in read()."),
    ],
  },
  {
    title: "[Negative] PythonFileReader — .txt suffix raises UnsupportedSuffixError",
    steps: [
      s("Ensure MaorAzureSkillTest/_tp18.txt exists with any text for the run.", "File exists for path validation."),
      s("Call read('MaorAzureSkillTest/_tp18.txt').", "Raises UnsupportedSuffixError; message contains .txt."),
      s("Read state after failure.", "ERROR from _check_suffix."),
      s("Confirm ext.lower() compared to '.py' in _check_suffix.", "Line 43–45 logic exercised."),
      s("Delete _tp18.txt in cleanup.", "Fixture removed after manual execution."),
    ],
  },
  {
    title: "[Boundary] PythonFileReader — invalid syntax in .py yields ValueError and FAILED state",
    steps: [
      s("Create MaorAzureSkillTest/_tp18_bad.py containing only: def x(", "File exists with .py suffix."),
      s("Call read on that path.", "extract_documentation raises ValueError Invalid Python syntax."),
      s("Read reader.state after exception in read().", "state equals FAILED (lines 97–98)."),
      s("Confirm logger.error path for unexpected error.", "Outer except in read executed."),
      s("Remove _tp18_bad.py after test.", "Cleanup complete."),
    ],
  },
  {
    title: "[State] PythonFileReader — IDLE to PROCESSING to COMPLETED on success",
    steps: [
      s("New PythonFileReader(); verify state IDLE.", "Baseline."),
      s("Successful read on valid .py under MaorAzureSkillTest.", "Final state COMPLETED."),
      s("Review source order in read(): PROCESSING at line 71 before _validate_path.", "Order confirmed."),
      s("Assert read() is the single public orchestration entry.", "Calls _validate_path, _check_suffix, open, extract_documentation."),
      s("Instantiate another reader for isolation.", "state IDLE again."),
    ],
  },
  {
    title: "[Integration] PythonFileReader — extract_documentation ast.walk output shape",
    steps: [
      s("Successful read of filereader.py; capture documentation.", "dict with module_doc and functions."),
      s("Verify module_doc via ast.get_docstring(module).", "None or string per file."),
      s("Assert functions['read'] docstring contains 'Single entry-point'.", "AC-4 satisfied."),
      s("Confirm content_length equals len(utf-8 file contents).", "Matches read bytes length."),
      s("Map suffix checklist to _check_suffix implementation.", "Only .py passes suffix gate."),
    ],
  },
  {
    title: "[Idempotency] PythonFileReader — two reads same file same content_length",
    steps: [
      s("PythonFileReader('.') and path MaorAzureSkillTest/filereader.py.", "IDLE."),
      s("First read; store L = content_length.", "success and L > 0."),
      s("Second read without modifying file.", "content_length equals L."),
      s("Compare sorted keys of documentation.functions twice.", "Identical key sets."),
      s("Both runs end state COMPLETED.", "Idempotent read behavior."),
    ],
  },
  {
    title: "[Boundary] PythonFileReader — uppercase .PY extension accepted via ext.lower()",
    steps: [
      s("Add minimal valid Python as MaorAzureSkillTest/_tp18_upper.PY.", "Fixture exists."),
      s("read('MaorAzureSkillTest/_tp18_upper.PY') with PythonFileReader('.').", "Success; COMPLETED."),
      s("Confirm _check_suffix passes.", "ext.lower() equals '.py'."),
      s("Delete _tp18_upper.PY after verification.", "Cleanup."),
      s("Cross-check line 43 condition.", "Uppercase extension normalized before compare."),
    ],
  },
];

const c = new AzureClient();
const pbi = await c.getPBI("18");
const planId = await c.syncTestPlan("18", test_cases, pbi.title);
console.log(JSON.stringify({ planId, cases: test_cases.length, title: pbi.title }));
