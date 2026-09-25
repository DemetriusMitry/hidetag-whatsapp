import ora from "ora";
import chalk from "chalk";
import clear from "console-clear";
import figlet from "figlet";
import qrcode from "qrcode-terminal";
import prompts from "prompts";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import pino from "pino";
import fs from "fs-extra";

const logger = pino({ level: "silent" });
const spinner = ora("Starting...").start();

let flowStarted = false;

const showBanner = () => {
  clear();
  const program_name = "Hidetag Whatsapp";
  const author =
    chalk.yellow("\nSource: ") +
    chalk.underline.greenBright("@demetrius_official\n");

  const howToUse =
    chalk.magenta.bold("Como usar:\n") +
    chalk.blueBright(
      `Após conectar, o programa vai listar os grupos e pedir o número (ou JID) e a mensagem para enviar com marcação oculta.\nDigite "sair" a qualquer momento para encerrar o programa.\n`
    );

  const banner = chalk.magentaBright(figlet.textSync(program_name));
  console.log(banner);
  console.log(author);
  console.log(howToUse);
  console.log("\n\n");
};

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label} demorou demais`)), ms)
    ),
  ]);

const listGroups = async (sock) => {
  spinner.start("Buscando grupos...");
  const chats = await withTimeout(
    sock.groupFetchAllParticipating(),
    15000,
    "groupFetchAllParticipating"
  );
  spinner.stop();

  const groups = Object.values(chats);

  console.log(chalk.cyan.bold("\nGrupos encontrados:\n"));
  groups.forEach((g, i) => {
    console.log(
      `${chalk.yellow(i + 1)}. ${chalk.green(g.subject)} ${chalk.gray(
        `(${g.id})`
      )}`
    );
  });
  console.log(chalk.gray('\n(Digite "sair" para encerrar)\n'));

  return groups;
};

const isExitCommand = (value) =>
  value && value.trim().toLowerCase() === "sair";

const exitProgram = () => {
  console.log(chalk.yellow("\nEncerrando o programa. Até mais!\n"));
  process.exit(0);
};

const runFlow = async (sock) => {
  const groups = await listGroups(sock);

  const { choice } = await prompts({
    type: "text",
    name: "choice",
    message: "Digite o número do grupo na lista (ou cole o JID):",
  });

  if (isExitCommand(choice)) {
    exitProgram();
    return;
  }

  if (!choice) {
    console.log(chalk.red("Nenhum valor informado. Tentando novamente...\n"));
    return runFlow(sock);
  }

  const cleanChoice = choice.trim();
  let groupJid;
  const index = parseInt(cleanChoice, 10) - 1;

  if (!isNaN(index) && groups[index]) {
    groupJid = groups[index].id;
  } else {
    groupJid = cleanChoice;
  }

  const { textMessage } = await prompts({
    type: "text",
    name: "textMessage",
    message: 'Digite a mensagem (ou "sair" para encerrar):',
  });

  if (isExitCommand(textMessage)) {
    exitProgram();
    return;
  }

  if (!textMessage) {
    console.log(chalk.red("Nenhuma mensagem informada. Tentando novamente...\n"));
    return runFlow(sock);
  }

  try {
    spinner.start("Buscando participantes do grupo...");
    const group = await withTimeout(
      sock.groupMetadata(groupJid),
      15000,
      "groupMetadata"
    );
    const groupParticipants = group.participants;
    spinner.stop();

    spinner.start("Enviando mensagem...");
    await withTimeout(
      sock.sendMessage(groupJid, {
        text: textMessage,
        mentions: groupParticipants.map((item) => item.id),
      }),
      15000,
      "sendMessage"
    );
    spinner.succeed(
      `Mensagem enviada para "${group.subject}" (${groupParticipants.length} participantes marcados).`
    );
  } catch (error) {
    spinner.fail(`Erro: ${error.message || error.toString()}`);
  }

  console.log(chalk.gray("\nAguardando 2 segundos para reiniciar...\n"));
  await new Promise((resolve) => setTimeout(resolve, 2000));

  runFlow(sock);
};

const whatsapp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState(".auth_sessions");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger,
    browser: ["Ihsan Devs", "Chrome", "20.0.04"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      showBanner();
      spinner.stop();
      qrcode.generate(qr, { small: true });
      spinner.start("Aguardando leitura do QR Code...");
    }

    if (connection === "close") {
      const loggedOut =
        lastDisconnect.error?.output?.statusCode === DisconnectReason.loggedOut;
      const shouldReconnect = !loggedOut;

      if (loggedOut) {
        fs.emptyDirSync(".auth_sessions");
        showBanner();
        whatsapp();
        return;
      }

      if (shouldReconnect) {
        showBanner();
        spinner.start("Reconectando...");
        whatsapp();
      }
    } else if (connection === "open" && !flowStarted) {
      flowStarted = true;
      spinner.succeed("Conexão aberta!");
      setTimeout(() => runFlow(sock), 2000);
    }
  });

  sock.ev.on("creds.update", saveCreds);
};

showBanner();
whatsapp();
